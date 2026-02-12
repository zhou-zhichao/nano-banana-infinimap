import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { TILE } from "@/lib/coords";
import { alignCompositeOverBase, translateImage } from "@/lib/drift";
import { readTileFile } from "@/lib/storage";
import { isTileInBounds } from "@/lib/tilemaps/bounds";
import { ensureTilemapsBootstrap } from "@/lib/tilemaps/bootstrap";
import { DEFAULT_MAP_ID } from "@/lib/tilemaps/constants";
import { getTilemapManifest } from "@/lib/tilemaps/service";

const TILE_SIZE = TILE;

type PreviewMeta = {
  mapId: string;
  z: number;
  x: number;
  y: number;
  createdAt: string;
};

async function createCircularGradientMask(size: number): Promise<Buffer> {
  const center = size / 2;
  const radius = size / 2;
  const width = size;
  const height = size;
  const channels = 4;
  const buf = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - center;
      const dy = y - center;
      const distance = Math.sqrt(dx * dx + dy * dy);
      let alpha = 0;
      if (distance <= radius * 0.5) alpha = 255;
      else if (distance < radius) alpha = Math.round(255 * (1 - (distance - radius * 0.5) / (radius * 0.5)));
      const index = (y * width + x) * channels;
      buf[index] = 255;
      buf[index + 1] = 255;
      buf[index + 2] = 255;
      buf[index + 3] = alpha;
    }
  }
  return sharp(buf, { raw: { width, height, channels: channels as 4 } }).png().toBuffer();
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
    create: { width: gridSize, height: gridSize, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(overlays)
    .webp()
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
    const mask = await createCircularGradientMask(gridSize);

    const baseTiles: Buffer[][] = [];
    for (let gy = 0; gy < 3; gy++) {
      const row: Buffer[] = [];
      for (let gx = 0; gx < 3; gx++) {
        const tileX = centerX + gx - 1;
        const tileY = centerY + gy - 1;
        if (!isTileInBounds(map, z, tileX, tileY)) {
          row.push(
            await sharp({
              create: { width: TILE_SIZE, height: TILE_SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
            })
              .png()
              .toBuffer(),
          );
          continue;
        }
        const existing = await readTileFile(previewMeta.mapId, z, tileX, tileY);
        if (existing) {
          row.push(await sharp(existing).resize(TILE_SIZE, TILE_SIZE, { fit: "fill" }).png().toBuffer());
        } else {
          row.push(
            await sharp({
              create: { width: TILE_SIZE, height: TILE_SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
            })
              .png()
              .toBuffer(),
          );
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

    const output: Buffer[][] = [];
    for (let dy = 0; dy < 3; dy++) {
      const row: Buffer[] = [];
      for (let dx = 0; dx < 3; dx++) {
        const tileX = centerX + dx - 1;
        const tileY = centerY + dy - 1;
        if (!isTileInBounds(map, z, tileX, tileY)) {
          row.push(
            await sharp({
              create: { width: TILE_SIZE, height: TILE_SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
            })
              .webp()
              .toBuffer(),
          );
          continue;
        }

        const existing = await readTileFile(previewMeta.mapId, z, tileX, tileY);
        const rawTile = await sharp(effectiveRaw)
          .extract({ left: dx * TILE_SIZE, top: dy * TILE_SIZE, width: TILE_SIZE, height: TILE_SIZE })
          .webp()
          .toBuffer();

        if (existing) {
          const tileMask = await sharp(mask)
            .extract({ left: dx * TILE_SIZE, top: dy * TILE_SIZE, width: TILE_SIZE, height: TILE_SIZE })
            .png()
            .toBuffer();
          const masked = await sharp(rawTile).composite([{ input: tileMask, blend: "dest-in" }]).webp().toBuffer();
          const blended = await sharp(existing)
            .resize(TILE_SIZE, TILE_SIZE, { fit: "fill" })
            .composite([{ input: masked, blend: "over" }])
            .webp()
            .toBuffer();
          row.push(blended);
        } else {
          row.push(rawTile);
        }
      }
      output.push(row);
    }

    const blendedComposite = await composite3x3(output);
    return new NextResponse(blendedComposite as any, {
      headers: { "Content-Type": "image/webp", "Cache-Control": "private, max-age=60" },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return NextResponse.json({ error: "Preview not found" }, { status: 404 });
    }
    console.error("Preview fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch preview" }, { status: 500 });
  }
}
