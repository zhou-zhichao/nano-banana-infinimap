import fs from "node:fs/promises";
import path from "node:path";
import { mapLocksDir } from "../tilemaps/paths";

const ensuredMaps = new Set<string>();
async function ensureLockDir(mapId: string) {
  const lockDir = mapLocksDir(mapId);
  if (!ensuredMaps.has(mapId)) {
    await fs.mkdir(lockDir, { recursive: true }).catch(() => {});
    ensuredMaps.add(mapId);
    // Clean up stale locks on startup
    await cleanStaleLocks(mapId);
  }
}

async function cleanStaleLocks(mapId: string) {
  const lockDir = mapLocksDir(mapId);
  try {
    const files = await fs.readdir(lockDir);
    const now = Date.now();
    for (const file of files) {
      if (file.endsWith('.lock')) {
        const lockFile = path.join(lockDir, file);
        const stats = await fs.stat(lockFile).catch(() => null);
        if (stats && (now - stats.mtimeMs > 30000)) { // Remove locks older than 30 seconds
          await fs.rm(lockFile).catch(() => {});
          console.log(`Removed stale lock: ${file}`);
        }
      }
    }
  } catch {}
}

function lockPath(mapId: string, name:string) { return path.join(mapLocksDir(mapId), `${name}.lock`); }

export async function withFileLock<T>(mapId: string, name:string, fn:()=>Promise<T>): Promise<T> {
  await ensureLockDir(mapId);
  const p = lockPath(mapId, name);
  const start = Date.now();
  
  // Check if lock exists and is stale
  const checkStale = async () => {
    try {
      const stats = await fs.stat(p);
      if (Date.now() - stats.mtimeMs > 10000) { // Lock older than 10 seconds
        await fs.rm(p).catch(() => {});
        console.log(`Removed stale lock: ${name}`);
        return true;
      }
    } catch {}
    return false;
  };
  
  while (true) {
    try {
      await fs.writeFile(p, String(process.pid), { flag: "wx" });
      break;
    } catch {
      // Check if lock is stale
      await checkStale();
      
      if (Date.now() - start > 5000) {
        // One final check for stale lock before giving up
        const wasStale = await checkStale();
        if (!wasStale) {
          throw new Error(`Lock timeout: ${name}`);
        }
      }
      await new Promise(r => setTimeout(r, 25 + Math.random()*25));
    }
  }
  
  try { 
    return await fn(); 
  } finally { 
    await fs.rm(p).catch(() => {}); 
  }
}
