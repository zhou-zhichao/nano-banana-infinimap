import fs from "node:fs/promises";
import { mapMetaDir, mapMetaPath } from "../tilemaps/paths";
import { DB, TileRecord } from "./db";

const ensuredMaps = new Set<string>();
async function ensureDirs(mapId: string) {
  if (ensuredMaps.has(mapId)) return;
  await fs.mkdir(mapMetaDir(mapId), { recursive: true }).catch(() => {});
  ensuredMaps.add(mapId);
}

function metaPath(mapId: string, z:number,x:number,y:number) {
  return mapMetaPath(mapId, z, x, y);
}

export class FileDB implements DB {
  async getTile(mapId: string, z:number,x:number,y:number): Promise<TileRecord|null> {
    await ensureDirs(mapId);
    try {
      const buf = await fs.readFile(metaPath(mapId, z, x, y), "utf-8");
      return JSON.parse(buf) as TileRecord;
    } catch { return null; }
  }

  async upsertTile(mapId: string, tr: Partial<TileRecord> & { z:number; x:number; y:number }): Promise<TileRecord> {
    await ensureDirs(mapId);
    const current = await this.getTile(mapId, tr.z, tr.x, tr.y);
    const now = new Date().toISOString();
    const merged: TileRecord = {
      z: tr.z, x: tr.x, y: tr.y,
      status: current?.status ?? "EMPTY",
      seed: tr.seed ?? current?.seed,
      hash: tr.hash ?? current?.hash,
      contentVer: tr.contentVer ?? current?.contentVer ?? 1,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    };
    if (tr.status) merged.status = tr.status;
    await fs.writeFile(metaPath(mapId, tr.z, tr.x, tr.y), JSON.stringify(merged));
    return merged;
  }

  async updateTile(mapId: string, z:number,x:number,y:number, patch: Partial<TileRecord>): Promise<TileRecord> {
    const cur = await this.getTile(mapId, z, x, y);
    const now = new Date().toISOString();
    const merged: TileRecord = {
      z,x,y,
      status: patch.status ?? cur?.status ?? "EMPTY",
      seed: patch.seed ?? cur?.seed,
      hash: patch.hash ?? cur?.hash,
      contentVer: patch.contentVer ?? cur?.contentVer ?? 1,
      createdAt: cur?.createdAt ?? now,
      updatedAt: now,
    };
    await fs.writeFile(metaPath(mapId, z, x, y), JSON.stringify(merged));
    return merged;
  }

  async getTiles(mapId: string, batch:{z:number,x:number,y:number}[]): Promise<TileRecord[]> {
    return Promise.all(batch.map((b) => this.getTile(mapId, b.z, b.x, b.y))).then((list) =>
      list.map((x) => x ?? ({ z: 0, x: 0, y: 0, status: "EMPTY" } as any)),
    );
  }
}

export const db = new FileDB();
