import path from "node:path";
import { TILEMAPS_MAPS_DIR, TILEMAPS_PRESETS_DIR, TILEMAPS_ROOT } from "../paths";
export { TILEMAPS_MAPS_DIR, TILEMAPS_PRESETS_DIR, TILEMAPS_ROOT } from "../paths";

export const TILEMAP_BOOTSTRAP_MARKER = path.join(TILEMAPS_ROOT, ".bootstrap-v1.json");
export const TILEMAPS_PRESET_MOON_ROOT = path.join(TILEMAPS_PRESETS_DIR, "moon");
export const TILEMAPS_PRESET_MOON_TILES_DIR = path.join(TILEMAPS_PRESET_MOON_ROOT, "tiles");
export const TILEMAPS_PRESET_MOON_ORPHANS_DIR = path.join(TILEMAPS_PRESET_MOON_ROOT, "orphans");

export function mapRootDir(mapId: string) {
  return path.join(TILEMAPS_MAPS_DIR, mapId);
}

export function mapManifestPath(mapId: string) {
  return path.join(mapRootDir(mapId), "map.json");
}

export function mapTilesDir(mapId: string) {
  return path.join(mapRootDir(mapId), "tiles");
}

export function mapMetaDir(mapId: string) {
  return path.join(mapRootDir(mapId), "meta");
}

export function mapLocksDir(mapId: string) {
  return path.join(mapRootDir(mapId), "locks");
}

export function mapQueueDir(mapId: string) {
  return path.join(mapRootDir(mapId), "queue");
}

export function mapTilePath(mapId: string, z: number, x: number, y: number) {
  return path.join(mapTilesDir(mapId), `${z}_${x}_${y}.webp`);
}

export function mapMetaPath(mapId: string, z: number, x: number, y: number) {
  return path.join(mapMetaDir(mapId), `${z}_${x}_${y}.json`);
}
