import { NextRequest } from "next/server";
import { ensureTilemapsBootstrap } from "./bootstrap";
import { DEFAULT_MAP_ID } from "./constants";
import { isValidMapId } from "./ids";
import { getTilemapManifest } from "./service";
import type { TilemapManifest } from "./types";

export class MapContextError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function resolveSearchParams(req: Request | NextRequest) {
  return new URL(req.url).searchParams;
}

export function mapIdFromRequest(req: Request | NextRequest) {
  const raw = resolveSearchParams(req).get("mapId");
  return raw && raw.trim() ? raw.trim() : DEFAULT_MAP_ID;
}

export async function resolveMapContext(
  req: Request | NextRequest,
): Promise<{ mapId: string; map: TilemapManifest }> {
  await ensureTilemapsBootstrap();
  const mapId = mapIdFromRequest(req);
  if (!isValidMapId(mapId)) {
    throw new MapContextError(400, "Invalid mapId");
  }
  const map = await getTilemapManifest(mapId);
  if (!map) {
    throw new MapContextError(404, `Tilemap "${mapId}" not found`);
  }
  return { mapId, map };
}
