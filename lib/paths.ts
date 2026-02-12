import path from "node:path";
export const ROOT = process.cwd();

export const TILEMAPS_ROOT = path.join(ROOT, ".tilemaps");
export const TILEMAPS_MAPS_DIR = path.join(TILEMAPS_ROOT, "maps");
export const TILEMAPS_PRESETS_DIR = path.join(TILEMAPS_ROOT, "presets");

export const LEGACY_TILE_DIR = path.join(ROOT, ".tiles");
export const LEGACY_META_DIR = path.join(ROOT, ".meta");
export const LEGACY_LOCK_DIR = path.join(ROOT, ".locks");
export const LEGACY_QUEUE_DIR = path.join(ROOT, ".queue");
