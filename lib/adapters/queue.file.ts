import fs from "node:fs/promises";
import { mapQueueDir } from "../tilemaps/paths";
import { Queue } from "./queue";
import { withFileLock } from "./lock.file";
import { generateTile } from "../generator";
import { bubbleHashes } from "../hashing";

const ensuredMaps = new Set<string>();
async function ensureQueueDir(mapId: string) {
  if (!ensuredMaps.has(mapId)) {
    await fs.mkdir(mapQueueDir(mapId), { recursive: true }).catch(() => {});
    ensuredMaps.add(mapId);
  }
}

const RUNNING = new Set<string>();

export const fileQueue: Queue = {
  async enqueue(name, payload) {
    await ensureQueueDir(payload.mapId);
    // serialize per-tile; run job right away (in-process)
    const key = `${payload.mapId}/${payload.z}/${payload.x}/${payload.y}`;
    if (RUNNING.has(key)) {
      console.log(`Job already running for tile ${key}, skipping`);
      return; // ignore duplicate bursts
    }
    RUNNING.add(key);
    try {
      await withFileLock(payload.mapId, `job_${key.replace(/\//g, '_')}`, async () => {
        const res = await generateTile(payload.mapId, payload.z, payload.x, payload.y, payload.prompt, {
          modelVariant: payload.modelVariant,
        });
        await bubbleHashes(payload.mapId, payload.z, payload.x, payload.y);
        return res;
      });
    } catch (error) {
      console.error(`Error processing tile ${key}:`, error);
      throw error;
    } finally {
      RUNNING.delete(key);
    }
  }
};
