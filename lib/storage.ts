import fs from "node:fs/promises";
import { mapTilePath, mapTilesDir, presetMoonTilePath } from "./tilemaps/paths";
import { DEFAULT_MAP_ID } from "./tilemaps/constants";
import { readTilemapManifest } from "./tilemaps/service";
import { resolveTilemapBaseStorage, type TilemapBaseStorage, type TilemapTemplate } from "./tilemaps/types";

let ensured = false;
const ensuredMaps = new Set<string>();
const MAP_STORAGE_CACHE_TTL_MS = 10_000;
type CachedMapStorage = {
  template: TilemapTemplate;
  baseStorage: TilemapBaseStorage;
  expiresAt: number;
};
const mapStorageCache = new Map<string, CachedMapStorage>();

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

async function readLocalTileFile(mapId: string, z: number, x: number, y: number) {
  try {
    return await fs.readFile(tilePath(mapId, z, x, y));
  } catch {
    return null;
  }
}

async function readPresetMoonTileFile(z: number, x: number, y: number) {
  try {
    return await fs.readFile(presetMoonTilePath(z, x, y));
  } catch {
    return null;
  }
}

async function resolveCachedMapStorageMode(mapId: string): Promise<{ template: TilemapTemplate; baseStorage: TilemapBaseStorage } | null> {
  const now = Date.now();
  const cached = mapStorageCache.get(mapId);
  if (cached && cached.expiresAt > now) {
    return { template: cached.template, baseStorage: cached.baseStorage };
  }

  const manifest = await readTilemapManifest(mapId);
  if (!manifest) {
    mapStorageCache.delete(mapId);
    return null;
  }

  const entry: CachedMapStorage = {
    template: manifest.template,
    baseStorage: resolveTilemapBaseStorage(manifest.baseStorage),
    expiresAt: now + MAP_STORAGE_CACHE_TTL_MS,
  };
  mapStorageCache.set(mapId, entry);
  return { template: entry.template, baseStorage: entry.baseStorage };
}

export function tilePath(mapId: string, z:number,x:number,y:number) {
  return mapTilePath(mapId, z, x, y);
}

export async function readTileFile(mapId: string, z:number,x:number,y:number) {
  const local = await readLocalTileFile(mapId, z, x, y);
  if (local) return local;

  const mode = await resolveCachedMapStorageMode(mapId);
  if (!mode) return null;
  if (mode.template !== "moon") return null;
  if (mode.baseStorage !== "preset_overlay") return null;
  return readPresetMoonTileFile(z, x, y);
}

export async function writeTileFile(mapId: string, z:number,x:number,y:number, buf:Buffer) {
  await ensureTileDir(mapId);
  await fs.writeFile(tilePath(mapId, z, x, y), buf);
}
