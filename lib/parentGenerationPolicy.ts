import { DEFAULT_MAP_ID } from "./tilemaps/constants";

export function shouldGenerateRealtimeParentTiles(mapId: string) {
  // `default` is bootstrapped from the moon preset, which already contains parent levels.
  return mapId !== DEFAULT_MAP_ID;
}
