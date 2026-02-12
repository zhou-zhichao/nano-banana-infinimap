import fs from "node:fs/promises";
import path from "node:path";
import { ZMAX } from "../coords";
import { LEGACY_META_DIR, LEGACY_TILE_DIR } from "../paths";
import { BOOTSTRAP_VERSION, DEFAULT_MAP_ID, DEFAULT_MAP_NAME, MOON_HEIGHT, MOON_WIDTH } from "./constants";
import {
  mapManifestPath,
  mapMetaDir,
  mapTilesDir,
  TILEMAP_BOOTSTRAP_MARKER,
  TILEMAPS_PRESET_MOON_ORPHANS_DIR,
  TILEMAPS_PRESET_MOON_TILES_DIR,
} from "./paths";
import { ensureTilemapDirs, ensureTilemapRootDirs, readTilemapManifest, writeTilemapManifest } from "./service";
import type { TilemapManifest } from "./types";

let bootPromise: Promise<void> | null = null;

async function pathExists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function copyFileIfNewer(src: string, dst: string) {
  let shouldCopy = true;
  try {
    const [srcStat, dstStat] = await Promise.all([fs.stat(src), fs.stat(dst)]);
    shouldCopy = srcStat.mtimeMs > dstStat.mtimeMs;
  } catch {
    shouldCopy = true;
  }
  if (!shouldCopy) return false;
  await fs.mkdir(path.dirname(dst), { recursive: true });
  await fs.copyFile(src, dst);
  return true;
}

async function migrateLegacyMoonTiles() {
  if (!(await pathExists(LEGACY_TILE_DIR))) {
    return { moved: 0, orphaned: 0 };
  }

  await fs.mkdir(TILEMAPS_PRESET_MOON_TILES_DIR, { recursive: true });
  await fs.mkdir(TILEMAPS_PRESET_MOON_ORPHANS_DIR, { recursive: true });

  const entries = await fs.readdir(LEGACY_TILE_DIR, { withFileTypes: true });
  let moved = 0;
  let orphaned = 0;

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".webp")) continue;
    const match = entry.name.match(/^(\d+)_(\d+)_(\d+)\.webp$/);
    const src = path.join(LEGACY_TILE_DIR, entry.name);
    if (!match) {
      await copyFileIfNewer(src, path.join(TILEMAPS_PRESET_MOON_ORPHANS_DIR, entry.name));
      orphaned += 1;
      continue;
    }

    const z = Number(match[1]);
    const oldY = Number(match[2]);
    const oldX = Number(match[3]);

    const isMoonInBounds =
      z === ZMAX &&
      oldX >= 0 &&
      oldX < MOON_WIDTH &&
      oldY >= 0 &&
      oldY < MOON_HEIGHT;

    if (isMoonInBounds) {
      const dstName = `${z}_${oldX}_${oldY}.webp`;
      const dst = path.join(TILEMAPS_PRESET_MOON_TILES_DIR, dstName);
      await copyFileIfNewer(src, dst);
      moved += 1;
      continue;
    }

    await copyFileIfNewer(src, path.join(TILEMAPS_PRESET_MOON_ORPHANS_DIR, entry.name));
    orphaned += 1;
  }

  return { moved, orphaned };
}

async function ensureDefaultTilemapFromMoon() {
  const existing = await readTilemapManifest(DEFAULT_MAP_ID);
  if (existing) {
    await ensureTilemapDirs(DEFAULT_MAP_ID);
    return existing;
  }

  const now = new Date().toISOString();
  const manifest: TilemapManifest = {
    id: DEFAULT_MAP_ID,
    name: DEFAULT_MAP_NAME,
    template: "moon",
    width: MOON_WIDTH,
    height: MOON_HEIGHT,
    createdAt: now,
    updatedAt: now,
  };
  await ensureTilemapDirs(DEFAULT_MAP_ID);
  await writeTilemapManifest(manifest);
  await fs.cp(TILEMAPS_PRESET_MOON_TILES_DIR, mapTilesDir(DEFAULT_MAP_ID), { recursive: true });
  return manifest;
}

async function migrateLegacyMetaToDefault() {
  if (!(await pathExists(LEGACY_META_DIR))) return 0;
  await fs.mkdir(mapMetaDir(DEFAULT_MAP_ID), { recursive: true });

  const entries = await fs.readdir(LEGACY_META_DIR, { withFileTypes: true });
  let copied = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const src = path.join(LEGACY_META_DIR, entry.name);
    const dst = path.join(mapMetaDir(DEFAULT_MAP_ID), entry.name);
    if (await copyFileIfNewer(src, dst)) copied += 1;
  }
  return copied;
}

async function writeMarker(payload: unknown) {
  await fs.mkdir(path.dirname(TILEMAP_BOOTSTRAP_MARKER), { recursive: true });
  await fs.writeFile(TILEMAP_BOOTSTRAP_MARKER, JSON.stringify(payload, null, 2));
}

async function runBootstrap() {
  await ensureTilemapRootDirs();
  await fs.mkdir(TILEMAPS_PRESET_MOON_TILES_DIR, { recursive: true });
  await fs.mkdir(TILEMAPS_PRESET_MOON_ORPHANS_DIR, { recursive: true });

  const markerExists = await pathExists(TILEMAP_BOOTSTRAP_MARKER);
  if (markerExists) {
    await ensureDefaultTilemapFromMoon();
    return;
  }

  const tileMigration = await migrateLegacyMoonTiles();
  await ensureDefaultTilemapFromMoon();
  const metaCopied = await migrateLegacyMetaToDefault();
  await writeMarker({
    version: BOOTSTRAP_VERSION,
    createdAt: new Date().toISOString(),
    tileMigration,
    metaCopied,
    defaultManifestPath: mapManifestPath(DEFAULT_MAP_ID),
    moonPresetTilesDir: TILEMAPS_PRESET_MOON_TILES_DIR,
  });
}

export async function ensureTilemapsBootstrap() {
  if (!bootPromise) {
    bootPromise = runBootstrap().catch((err) => {
      bootPromise = null;
      throw err;
    });
  }
  await bootPromise;
}
