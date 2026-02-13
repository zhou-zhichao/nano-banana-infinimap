import { NextRequest } from "next/server";
import { resolveMapContext } from "@/lib/tilemaps/context";
import { clampTimelineIndex, getTimelineManifest } from "./manifest";
import { TimelineContext, TimelineManifest } from "./types";

function parseTimelineIndexRaw(value: string | null) {
  if (!value) return 1;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 1;
}

export function parseTimelineIndexFromRequest(req: Request | NextRequest) {
  const url = new URL(req.url);
  return parseTimelineIndexRaw(url.searchParams.get("t"));
}

export function parseTimelineIndexFromSearchParams(searchParams: URLSearchParams) {
  return parseTimelineIndexRaw(searchParams.get("t"));
}

export async function resolveTimelineContext(mapId: string, requestedIndex: number): Promise<TimelineContext> {
  const manifest = await getTimelineManifest(mapId);
  const index = clampTimelineIndex(requestedIndex, manifest);
  const node = manifest.nodes[index - 1];
  return {
    mapId,
    requestedIndex,
    index,
    node,
    manifest,
  };
}

export async function resolveTimelineContextFromRequest(req: Request | NextRequest): Promise<TimelineContext> {
  const { mapId } = await resolveMapContext(req);
  const requestedIndex = parseTimelineIndexFromRequest(req);
  return resolveTimelineContext(mapId, requestedIndex);
}

export async function resolveTimelineContextByNodeId(mapId: string, nodeId: string): Promise<TimelineContext | null> {
  const manifest = await getTimelineManifest(mapId);
  const idx = manifest.nodes.findIndex((node) => node.id === nodeId);
  if (idx < 0) return null;
  return {
    mapId,
    requestedIndex: idx + 1,
    index: idx + 1,
    node: manifest.nodes[idx],
    manifest,
  };
}

export function findTimelineIndexByNodeId(manifest: TimelineManifest, nodeId: string) {
  const idx = manifest.nodes.findIndex((node) => node.id === nodeId);
  return idx >= 0 ? idx + 1 : null;
}
