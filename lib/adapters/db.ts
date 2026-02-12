export type TileStatus = "EMPTY" | "PENDING" | "READY";

export interface TileRecord {
  z: number; x: number; y: number;
  status: TileStatus;
  seed?: string;          // hex or decimal string
  hash?: string;          // short content hash
  contentVer?: number;    // increments on change
  updatedAt?: string;     // ISO date
  createdAt?: string;     // ISO date
}

export interface DB {
  getTile(mapId: string, z:number,x:number,y:number): Promise<TileRecord | null>;
  upsertTile(mapId: string, tr: Partial<TileRecord> & { z:number; x:number; y:number }): Promise<TileRecord>;
  updateTile(mapId: string, z:number,x:number,y:number, patch: Partial<TileRecord>): Promise<TileRecord>;
  getTiles(mapId: string, batch: {z:number,x:number,y:number}[]): Promise<TileRecord[]>;
}

export function key(z:number,x:number,y:number) { return `${z}_${x}_${y}`; }
