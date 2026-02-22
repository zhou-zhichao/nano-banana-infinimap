import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { z } from "zod";
import { parentOf, TILE } from "@/lib/coords";
import { estimateGridDriftFromExistingTiles, translateImage } from "@/lib/drift";
import { blake2sHex } from "@/lib/hashing";
import { shouldGenerateRealtimeParentTiles } from "@/lib/parentGenerationPolicy";
import { generateParentTileAtNode } from "@/lib/parentTiles";
import { blendSeamGridImage, PythonImageServiceError } from "@/lib/pythonImageService";
import { buildSeamBlendContext, extractSeamCenter3x3 } from "@/lib/seamBlendContext";
import { isTileInBounds } from "@/lib/tilemaps/bounds";
import { MapContextError, resolveMapContext } from "@/lib/tilemaps/context";
import { parseTimelineIndexFromRequest, resolveTimelineContext } from "@/lib/timeline/context";
import { resolveEffectiveTileBuffer, writeTimelineTileReady } from "@/lib/timeline/storage";

const requestSchema = z.object({
  previewUrl: z.string(),
  previewMode: z.enum(["raw", "blended"]).optional(),
  applyToAllNew: z.boolean().optional(),
  newTilePositions: z.array(z.object({ x: z.number(), y: z.number() })).optional(),
  selectedPositions: z.array(z.object({ x: z.number(), y: z.number() })).optional(),
  offsetX: z.number().optional(),
  offsetY: z.number().optional(),
});

type PreviewMeta = {
  mapId: string;
  z: number;
  x: number;
  y: number;
  timelineNodeId: string;
  timelineIndex: number;
  createdAt: string;
};

async function extractTiles(compositeBuffer: Buffer): Promise<Buffer[][]> {
  const tiles: Buffer[][] = [];
  for (let yy = 0; yy < 3; yy++) {
    const row: Buffer[] = [];
    for (let xx = 0; xx < 3; xx++) {
      const tile = await sharp(compositeBuffer)
        .extract({ left: xx * TILE, top: yy * TILE, width: TILE, height: TILE })
        .webp()
        .toBuffer();
      row.push(tile);
    }
    tiles.push(row);
  }
  return tiles;
}

function previewIdFromUrl(previewUrl: string) {
  const match = previewUrl.match(/\/api\/preview\/([a-zA-Z0-9-]+)/);
  return match?.[1] ?? null;
}

async function readPreviewMeta(tempDir: string, previewId: string): Promise<PreviewMeta> {
  const raw = await fs.readFile(path.join(tempDir, `${previewId}.json`), "utf-8");
  return JSON.parse(raw) as PreviewMeta;
}

function extractPythonServiceMessage(error: PythonImageServiceError, fallback: string): string {
  const responseBody = error.responseBody?.trim();
  if (responseBody) {
    try {
      const parsed = JSON.parse(responseBody) as { detail?: unknown; error?: unknown };
      if (typeof parsed.detail === "string" && parsed.detail.trim()) {
        return parsed.detail.trim();
      }
      if (typeof parsed.error === "string" && parsed.error.trim()) {
        return parsed.error.trim();
      }
    } catch {
      return responseBody;
    }
    return responseBody;
  }
  return error.message || fallback;
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ z: string; x: string; y: string }> },
) {
  let mapId = "default";
  let map: any = null;
  let timelineIndex = 1;

  try {
    const resolved = await resolveMapContext(req);
    mapId = resolved.mapId;
    map = resolved.map;
    timelineIndex = parseTimelineIndexFromRequest(req);
  } catch (error) {
    if (error instanceof MapContextError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Failed to resolve map context" }, { status: 500 });
  }

  try {
    const params = await context.params;
    const z = Number(params.z);
    const centerX = Number(params.x);
    const centerY = Number(params.y);
    if (!isTileInBounds(map, z, centerX, centerY)) {
      return NextResponse.json({ error: "Tile is outside map bounds" }, { status: 400 });
    }

    const timeline = await resolveTimelineContext(mapId, timelineIndex);
    const body = await req.json();
    const { previewUrl, previewMode, offsetX, offsetY } = requestSchema.parse(body);
    const effectivePreviewMode = previewMode ?? "blended";

    const previewId = previewIdFromUrl(previewUrl);
    if (!previewId) {
      return NextResponse.json({ error: "Invalid preview URL" }, { status: 400 });
    }

    const tempDir = path.join(process.cwd(), ".temp");
    const previewPath = path.join(tempDir, `${previewId}.webp`);
    const previewMeta = await readPreviewMeta(tempDir, previewId);
    if (previewMeta.mapId !== mapId) {
      return NextResponse.json({ error: "Preview map mismatch" }, { status: 400 });
    }
    if (previewMeta.z !== z || previewMeta.x !== centerX || previewMeta.y !== centerY) {
      return NextResponse.json({ error: "Preview coordinate mismatch" }, { status: 400 });
    }
    if (previewMeta.timelineNodeId !== timeline.node.id) {
      return NextResponse.json({ error: "Preview timeline mismatch" }, { status: 400 });
    }

    let compositeBuffer: Buffer;
    try {
      compositeBuffer = await fs.readFile(previewPath);
    } catch {
      return NextResponse.json({ error: "Preview not found" }, { status: 404 });
    }

    const gridSize = TILE * 3;
    compositeBuffer = await sharp(compositeBuffer).png().toBuffer();

    let driftCorrection: {
      source: "manual" | "auto" | "none";
      tx: number;
      ty: number;
      candidateCount: number;
      confidence: number;
    } = {
      source: "none",
      tx: 0,
      ty: 0,
      candidateCount: 0,
      confidence: 0,
    };

    if (effectivePreviewMode === "blended") {
      if (
        typeof offsetX === "number" &&
        typeof offsetY === "number" &&
        Number.isFinite(offsetX) &&
        Number.isFinite(offsetY)
      ) {
        const tx = Math.round(offsetX);
        const ty = Math.round(offsetY);
        compositeBuffer = await translateImage(compositeBuffer, gridSize, gridSize, tx, ty);
        driftCorrection = { source: "manual", tx, ty, candidateCount: 0, confidence: 1 };
      } else {
        let hasAnyExisting = false;
        outer: for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const tileX = centerX + dx;
            const tileY = centerY + dy;
            if (!isTileInBounds(map, z, tileX, tileY)) continue;
            const existing = await resolveEffectiveTileBuffer(timeline, z, tileX, tileY);
            if (existing) {
              hasAnyExisting = true;
              break outer;
            }
          }
        }

        if (hasAnyExisting) {
          try {
            const estimated = await estimateGridDriftFromExistingTiles({
              rawComposite: compositeBuffer,
              z,
              centerX,
              centerY,
              selectedSet: null,
              tileSize: TILE,
              readTile: (tileZ, tileX, tileY) => resolveEffectiveTileBuffer(timeline, tileZ, tileX, tileY),
            });

            driftCorrection = {
              source: estimated.source,
              tx: estimated.applied ? estimated.tx : 0,
              ty: estimated.applied ? estimated.ty : 0,
              candidateCount: estimated.candidateCount,
              confidence: estimated.confidence,
            };
            if (estimated.applied) {
              compositeBuffer = await translateImage(compositeBuffer, gridSize, gridSize, estimated.tx, estimated.ty);
            }
          } catch (driftErr) {
            console.warn("Auto drift estimation failed:", driftErr);
          }
        }
      }
    }

    if (effectivePreviewMode === "blended") {
      const seamContext = await buildSeamBlendContext({
        map,
        timeline,
        z,
        centerX,
        centerY,
        rawComposite3x3: compositeBuffer,
        tileSize: TILE,
      });
      const blended5x5 = await blendSeamGridImage({
        basePng: seamContext.basePng,
        overlayPng: seamContext.overlayPng,
        overlayMaskPng: seamContext.overlayMaskPng,
        tileSize: seamContext.tileSize,
        centerOffsetTiles: seamContext.centerOffsetTiles,
      });
      compositeBuffer = await extractSeamCenter3x3(blended5x5.imageBuffer, TILE);
    }

    const generatedTiles = await extractTiles(compositeBuffer);
    const updatedPositions: { x: number; y: number }[] = [];

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const tileX = centerX + dx;
        const tileY = centerY + dy;
        if (!isTileInBounds(map, z, tileX, tileY)) continue;

        const finalTile = generatedTiles[dy + 1][dx + 1];
        const hash = blake2sHex(finalTile);
        await writeTimelineTileReady(mapId, timeline.node.id, z, tileX, tileY, finalTile, { hash });
        updatedPositions.push({ x: tileX, y: tileY });
      }
    }

    if (shouldGenerateRealtimeParentTiles(mapId, "confirm-edit")) {
      let levelZ = z;
      let currentLevel = new Set(updatedPositions.map((position) => `${position.x},${position.y}`));
      while (levelZ > 0 && currentLevel.size > 0) {
        const parents = new Map<string, { x: number; y: number }>();
        for (const key of currentLevel) {
          const [cx, cy] = key.split(",").map(Number);
          const parent = parentOf(levelZ, cx, cy);
          if (!isTileInBounds(map, levelZ - 1, parent.x, parent.y)) continue;
          parents.set(`${parent.x},${parent.y}`, { x: parent.x, y: parent.y });
        }

        for (const parent of parents.values()) {
          await generateParentTileAtNode(timeline, levelZ - 1, parent.x, parent.y);
        }

        currentLevel = new Set(Array.from(parents.keys()));
        levelZ -= 1;
      }
    }

    await fs.unlink(previewPath).catch(() => {});
    await fs.unlink(path.join(tempDir, `${previewId}.json`)).catch(() => {});

    return NextResponse.json({
      success: true,
      message: "Tiles updated successfully",
      driftCorrection,
      timelineIndex: timeline.index,
    });
  } catch (error) {
    if (error instanceof PythonImageServiceError) {
      const message = extractPythonServiceMessage(error, "Failed to blend tiles with OpenCV seam pipeline");
      return NextResponse.json(
        { error: message },
        { status: error.statusCode || 500 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to confirm edit" },
      { status: 500 },
    );
  }
}
