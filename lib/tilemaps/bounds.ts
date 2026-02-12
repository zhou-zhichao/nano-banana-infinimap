import { ZMAX } from "../coords";
import type { TilemapManifest } from "./types";

export function tileGridSizeAtZoom(map: TilemapManifest, z: number) {
  if (z < 0 || z > ZMAX) {
    return { width: 0, height: 0 };
  }
  const divisor = 2 ** (ZMAX - z);
  return {
    width: Math.ceil(map.width / divisor),
    height: Math.ceil(map.height / divisor),
  };
}

export function isTileInBounds(map: TilemapManifest, z: number, x: number, y: number) {
  if (!Number.isFinite(z) || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) return false;
  if (z < 0 || z > ZMAX) return false;
  const grid = tileGridSizeAtZoom(map, z);
  return x >= 0 && y >= 0 && x < grid.width && y < grid.height;
}
