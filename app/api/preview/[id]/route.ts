import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { TILE } from "@/lib/coords";
import { alignCompositeOverBase, translateImage } from "@/lib/drift";
import { blendSeamGridImage, PythonImageServiceError } from "@/lib/pythonImageService";
import { buildSeamBlendContext, extractSeamCenter3x3 } from "@/lib/seamBlendContext";
import { isTileInBounds } from "@/lib/tilemaps/bounds";
import { ensureTilemapsBootstrap } from "@/lib/tilemaps/bootstrap";
import { DEFAULT_MAP_ID } from "@/lib/tilemaps/constants";
import { getTilemapManifest } from "@/lib/tilemaps/service";
import { resolveTimelineContextByNodeId } from "@/lib/timeline/context";
import { resolveEffectiveTileBuffer } from "@/lib/timeline/storage";

const TILE_SIZE = TILE;

type PreviewMeta = {
  mapId: string;
  z: number;
  x: number;
  y: number;
  timelineNodeId: string;
  timelineIndex: number;
  createdAt: string;
};

async function createTransparentTilePng(): Promise<Buffer> {
  return sharp({
    create: {
      width: TILE_SIZE,
      height: TILE_SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .png()
    .toBuffer();
}

async function composite3x3(tiles: Buffer[][]): Promise<Buffer> {
  const gridSize = TILE_SIZE * 3;
  const overlays: sharp.OverlayOptions[] = [];
  for (let yy = 0; yy < 3; yy++) {
    for (let xx = 0; xx < 3; xx++) {
      overlays.push({ input: tiles[yy][xx], left: xx * TILE_SIZE, top: yy * TILE_SIZE });
    }
  }
  return sharp({
    create: {
      width: gridSize,
      height: gridSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(overlays)
    .png()
    .toBuffer();
}

function parsePreviewId(id: string) {
  return /^preview-[a-z0-9-]+$/i.test(id) ? id : null;
}

async function readPreviewMeta(previewId: string) {
  const tempDir = path.join(process.cwd(), ".temp");
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

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await ensureTilemapsBootstrap();

    const { id } = await context.params;
    const previewId = parsePreviewId(id);
    if (!previewId) {
      return NextResponse.json({ error: "Invalid preview ID" }, { status: 400 });
    }

    const url = new URL(req.url);
    const mode = url.searchParams.get("mode") || "raw";
    const align = url.searchParams.get("align") !== "0";
    const txParam = url.searchParams.get("tx");
    const tyParam = url.searchParams.get("ty");
    const tx = txParam != null ? Number(txParam) || 0 : null;
    const ty = tyParam != null ? Number(tyParam) || 0 : null;
    const requestedMapId = url.searchParams.get("mapId") || DEFAULT_MAP_ID;

    const previewMeta = await readPreviewMeta(previewId);
    if (requestedMapId !== previewMeta.mapId) {
      return NextResponse.json({ error: "Preview map mismatch" }, { status: 400 });
    }
    const map = await getTilemapManifest(previewMeta.mapId);
    if (!map) {
      return NextResponse.json({ error: "Tilemap not found" }, { status: 404 });
    }

    const previewTimeline = await resolveTimelineContextByNodeId(previewMeta.mapId, previewMeta.timelineNodeId);
    if (!previewTimeline) {
      return NextResponse.json({ error: "Preview timeline node not found" }, { status: 404 });
    }

    const previewPath = path.join(process.cwd(), ".temp", `${previewId}.webp`);
    const raw = await fs.readFile(previewPath);
    if (mode !== "blended") {
      return new NextResponse(raw as any, {
        headers: { "Content-Type": "image/webp", "Cache-Control": "private, max-age=60" },
      });
    }

    const z = previewMeta.z;
    const centerX = previewMeta.x;
    const centerY = previewMeta.y;
    const gridSize = TILE_SIZE * 3;
    const transparentTile = await createTransparentTilePng();

    const baseTiles: Buffer[][] = [];
    for (let gy = 0; gy < 3; gy++) {
      const row: Buffer[] = [];
      for (let gx = 0; gx < 3; gx++) {
        const tileX = centerX + gx - 1;
        const tileY = centerY + gy - 1;
        if (!isTileInBounds(map, z, tileX, tileY)) {
          row.push(transparentTile);
          continue;
        }
        const existing = await resolveEffectiveTileBuffer(previewTimeline, z, tileX, tileY);
        if (existing) {
          row.push(await sharp(existing).resize(TILE_SIZE, TILE_SIZE, { fit: "fill" }).png().toBuffer());
        } else {
          row.push(transparentTile);
        }
      }
      baseTiles.push(row);
    }

    const baseComposite = await composite3x3(baseTiles);
    let effectiveRaw = raw;
    if (tx != null && ty != null) {
      effectiveRaw = await translateImage(raw, gridSize, gridSize, tx, ty);
    } else if (align) {
      try {
        const { aligned } = await alignCompositeOverBase(baseComposite, raw, TILE_SIZE);
        effectiveRaw = aligned;
      } catch {
        effectiveRaw = raw;
      }
    }

    const seamContext = await buildSeamBlendContext({
      map,
      timeline: previewTimeline,
      z,
      centerX,
      centerY,
      rawComposite3x3: await sharp(effectiveRaw).png().toBuffer(),
      tileSize: TILE_SIZE,
    });
    const blended5x5 = await blendSeamGridImage({
      basePng: seamContext.basePng,
      overlayPng: seamContext.overlayPng,
      overlayMaskPng: seamContext.overlayMaskPng,
      tileSize: seamContext.tileSize,
      centerOffsetTiles: seamContext.centerOffsetTiles,
    });
    const blendedCenter3x3 = await extractSeamCenter3x3(blended5x5.imageBuffer, TILE_SIZE);
    const blendedComposite = await sharp(blendedCenter3x3).webp().toBuffer();

    return new NextResponse(blendedComposite as any, {
      headers: { "Content-Type": "image/webp", "Cache-Control": "private, max-age=60" },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return NextResponse.json({ error: "Preview not found" }, { status: 404 });
    }
    if (error instanceof PythonImageServiceError) {
      const message = extractPythonServiceMessage(error, "Failed to blend preview with OpenCV seam pipeline");
      return NextResponse.json(
        { error: message },
        { status: error.statusCode || 500 },
      );
    }
    console.error("Preview fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch preview" }, { status: 500 });
  }
}
