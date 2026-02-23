export type TilemapTemplate = "blank" | "moon";
export type TilemapBaseStorage = "copied" | "preset_overlay";

export interface TilemapManifest {
  id: string;
  name: string;
  template: TilemapTemplate;
  baseStorage?: TilemapBaseStorage;
  width: number;
  height: number;
  createdAt: string;
  updatedAt: string;
}

export function resolveTilemapBaseStorage(baseStorage?: TilemapBaseStorage): TilemapBaseStorage {
  return baseStorage ?? "copied";
}

export interface CreateTilemapInput {
  name: string;
  template: TilemapTemplate;
  width?: number;
  height?: number;
}
