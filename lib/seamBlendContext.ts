import sharp from "sharp";
import { TILE } from "@/lib/coords";
import { isTileInBounds } from "@/lib/tilemaps/bounds";
import type { TilemapManifest } from "@/lib/tilemaps/types";
import { resolveEffectiveTileBuffer } from "@/lib/timeline/storage";
import type { TimelineContext } from "@/lib/timeline/types";

export const SEAM_CONTEXT_TILE_SPAN = 5;
export const SEAM_FOCUS_TILE_SPAN = 3;
export const SEAM_CENTER_OFFSET_TILES = 1;

export type SeamBlendContextPayload = {
  basePng: Buffer;
  overlayPng: Buffer;
  overlayMaskPng: Buffer;
  tileSize: number;
  centerOffsetTiles: number;
};

function createTransparentCanvas(size: number): sharp.Sharp {
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  });
}

export function getSeamCenterRect(tileSize = TILE) {
  return {
    left: tileSize * SEAM_CENTER_OFFSET_TILES,
    top: tileSize * SEAM_CENTER_OFFSET_TILES,
    width: tileSize * SEAM_FOCUS_TILE_SPAN,
    height: tileSize * SEAM_FOCUS_TILE_SPAN,
  };
}

function fillMaskRect(mask: Buffer, width: number, left: number, top: number, rectSize: number) {
  for (let y = top; y < top + rectSize; y++) {
    const rowStart = y * width + left;
    mask.fill(255, rowStart, rowStart + rectSize);
  }
}

export async function buildSeamBlendContext(options: {
  map: TilemapManifest;
  timeline: TimelineContext;
  z: number;
  centerX: number;
  centerY: number;
  rawComposite3x3: Buffer;
  tileSize?: number;
}): Promise<SeamBlendContextPayload> {
  const { map, timeline, z, centerX, centerY, rawComposite3x3 } = options;
  const tileSize = options.tileSize ?? TILE;
  const contextSize = tileSize * SEAM_CONTEXT_TILE_SPAN;

  const baseOverlays: sharp.OverlayOptions[] = [];
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const tileX = centerX + dx;
      const tileY = centerY + dy;
      if (!isTileInBounds(map, z, tileX, tileY)) continue;

      const existing = await resolveEffectiveTileBuffer(timeline, z, tileX, tileY);
      if (!existing) continue;

      const resized = await sharp(existing).resize(tileSize, tileSize, { fit: "fill" }).png().toBuffer();
      baseOverlays.push({
        input: resized,
        left: (dx + 2) * tileSize,
        top: (dy + 2) * tileSize,
      });
    }
  }

  const basePng = await createTransparentCanvas(contextSize).composite(baseOverlays).png().toBuffer();
  const centerRect = getSeamCenterRect(tileSize);
  const overlay3x3 = await sharp(rawComposite3x3)
    .resize(centerRect.width, centerRect.height, { fit: "fill" })
    .png()
    .toBuffer();
  const overlayPng = await createTransparentCanvas(contextSize)
    .composite([{ input: overlay3x3, left: centerRect.left, top: centerRect.top }])
    .png()
    .toBuffer();

  const mask = Buffer.alloc(contextSize * contextSize, 0);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const tileX = centerX + dx;
      const tileY = centerY + dy;
      if (!isTileInBounds(map, z, tileX, tileY)) continue;
      fillMaskRect(mask, contextSize, (dx + 2) * tileSize, (dy + 2) * tileSize, tileSize);
    }
  }

  const overlayMaskPng = await sharp(mask, {
    raw: { width: contextSize, height: contextSize, channels: 1 },
  })
    .png()
    .toBuffer();

  return {
    basePng,
    overlayPng,
    overlayMaskPng,
    tileSize,
    centerOffsetTiles: SEAM_CENTER_OFFSET_TILES,
  };
}

export async function extractSeamCenter3x3(composite5x5: Buffer, tileSize = TILE): Promise<Buffer> {
  const centerRect = getSeamCenterRect(tileSize);
  return sharp(composite5x5)
    .extract({
      left: centerRect.left,
      top: centerRect.top,
      width: centerRect.width,
      height: centerRect.height,
    })
    .png()
    .toBuffer();
}
