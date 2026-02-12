import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_MAP_ID, MOON_HEIGHT, MOON_WIDTH } from "./constants";
import { isValidMapId, slugifyMapId } from "./ids";
import {
  mapLocksDir,
  mapManifestPath,
  mapMetaDir,
  mapQueueDir,
  mapRootDir,
  mapTilesDir,
  TILEMAPS_MAPS_DIR,
  TILEMAPS_PRESET_MOON_TILES_DIR,
} from "./paths";
import type { CreateTilemapInput, TilemapManifest, TilemapTemplate } from "./types";

async function pathExists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function ensureTilemapRootDirs() {
  await fs.mkdir(TILEMAPS_MAPS_DIR, { recursive: true });
  await fs.mkdir(TILEMAPS_PRESET_MOON_TILES_DIR, { recursive: true });
}

export async function ensureTilemapDirs(mapId: string) {
  await fs.mkdir(mapRootDir(mapId), { recursive: true });
  await fs.mkdir(mapTilesDir(mapId), { recursive: true });
  await fs.mkdir(mapMetaDir(mapId), { recursive: true });
  await fs.mkdir(mapLocksDir(mapId), { recursive: true });
  await fs.mkdir(mapQueueDir(mapId), { recursive: true });
}

export async function readTilemapManifest(mapId: string): Promise<TilemapManifest | null> {
  if (!isValidMapId(mapId)) return null;
  try {
    const raw = await fs.readFile(mapManifestPath(mapId), "utf-8");
    const parsed = JSON.parse(raw) as TilemapManifest;
    if (!isValidMapId(parsed.id)) return null;
    if (!parsed.name || !parsed.template) return null;
    if (!Number.isInteger(parsed.width) || parsed.width < 1) return null;
    if (!Number.isInteger(parsed.height) || parsed.height < 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeTilemapManifest(manifest: TilemapManifest) {
  await ensureTilemapDirs(manifest.id);
  await fs.writeFile(mapManifestPath(manifest.id), JSON.stringify(manifest, null, 2));
}

export async function listTilemaps(): Promise<TilemapManifest[]> {
  await ensureTilemapRootDirs();
  const entries = await fs.readdir(TILEMAPS_MAPS_DIR, { withFileTypes: true });
  const manifests = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && isValidMapId(entry.name))
      .map((entry) => readTilemapManifest(entry.name)),
  );

  return manifests
    .filter((m): m is TilemapManifest => Boolean(m))
    .sort((a, b) => {
      if (a.id === DEFAULT_MAP_ID) return -1;
      if (b.id === DEFAULT_MAP_ID) return 1;
      return a.createdAt.localeCompare(b.createdAt);
    });
}

export async function getTilemapManifest(mapId: string) {
  return readTilemapManifest(mapId);
}

async function nextAvailableMapId(baseName: string) {
  const base = slugifyMapId(baseName);
  let candidate = base;
  let i = 2;
  while (await pathExists(path.join(TILEMAPS_MAPS_DIR, candidate))) {
    candidate = `${base}-${i}`;
    i += 1;
  }
  return candidate;
}

function normalizeBlankSize(width?: number, height?: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    throw new Error("Blank tilemap width/height must be integers");
  }
  if (width! < 1 || width! > 256 || height! < 1 || height! > 256) {
    throw new Error("Blank tilemap width/height must be in range 1..256");
  }
  return { width: width!, height: height! };
}

async function copyMoonPresetToMap(mapId: string) {
  await fs.mkdir(mapTilesDir(mapId), { recursive: true });
  await fs.cp(TILEMAPS_PRESET_MOON_TILES_DIR, mapTilesDir(mapId), { recursive: true });
}

export async function createTilemap(input: CreateTilemapInput): Promise<TilemapManifest> {
  await ensureTilemapRootDirs();
  const name = input.name.trim();
  if (!name) throw new Error("Tilemap name is required");
  const template: TilemapTemplate = input.template;
  const mapId = await nextAvailableMapId(name);
  const now = new Date().toISOString();

  let width = input.width;
  let height = input.height;
  if (template === "moon") {
    width = MOON_WIDTH;
    height = MOON_HEIGHT;
  } else {
    ({ width, height } = normalizeBlankSize(width, height));
  }

  const manifest: TilemapManifest = {
    id: mapId,
    name,
    template,
    width: width!,
    height: height!,
    createdAt: now,
    updatedAt: now,
  };

  await ensureTilemapDirs(mapId);
  await writeTilemapManifest(manifest);

  if (template === "moon") {
    await copyMoonPresetToMap(mapId);
  }

  return manifest;
}
