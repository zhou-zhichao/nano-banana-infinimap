export type TilemapTemplate = "blank" | "moon";

export interface TilemapManifest {
  id: string;
  name: string;
  template: TilemapTemplate;
  width: number;
  height: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTilemapInput {
  name: string;
  template: TilemapTemplate;
  width?: number;
  height?: number;
}
