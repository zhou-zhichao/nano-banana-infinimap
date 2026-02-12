import fs from "node:fs/promises";
import { mapTilePath, mapTilesDir } from "./tilemaps/paths";
import { DEFAULT_MAP_ID } from "./tilemaps/constants";

let ensured = false;
const ensuredMaps = new Set<string>();
async function ensureTileDir(mapId: string) {
  if (!ensured) {
    await fs.mkdir(mapTilesDir(DEFAULT_MAP_ID), { recursive: true }).catch(() => {});
    ensured = true;
  }
  if (!ensuredMaps.has(mapId)) {
    await fs.mkdir(mapTilesDir(mapId), { recursive: true }).catch(() => {});
    ensuredMaps.add(mapId);
  }
}

export function tilePath(mapId: string, z:number,x:number,y:number) {
  return mapTilePath(mapId, z, x, y);
}

export async function readTileFile(mapId: string, z:number,x:number,y:number) {
  try { return await fs.readFile(tilePath(mapId, z, x, y)); }
  catch { return null; }
}

export async function writeTileFile(mapId: string, z:number,x:number,y:number, buf:Buffer) {
  await ensureTileDir(mapId);
  await fs.writeFile(tilePath(mapId, z, x, y), buf);
}
