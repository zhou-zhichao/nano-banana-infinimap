import { NextResponse } from "next/server";
import { isTileInBounds } from "@/lib/tilemaps/bounds";
import { MapContextError, resolveMapContext } from "@/lib/tilemaps/context";
import { parseTimelineIndexFromRequest, resolveTimelineContext } from "@/lib/timeline/context";
import { readTimelineNodeMeta, resolveEffectiveTileMeta } from "@/lib/timeline/storage";

export async function GET(req: Request, { params }: { params: Promise<{ z: string; x: string; y: string }> }) {
  let mapId = "default";
  let map: any = null;
  let timelineIndex = 1;

  try {
    const resolved = await resolveMapContext(req);
    mapId = resolved.mapId;
    map = resolved.map;
    timelineIndex = parseTimelineIndexFromRequest(req);
  } catch (error) {
    if (error instanceof MapContextError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Failed to resolve map context" }, { status: 500 });
  }

  const { z: zStr, x: xStr, y: yStr } = await params;
  const z = Number(zStr);
  const x = Number(xStr);
  const y = Number(yStr);
  if (!isTileInBounds(map, z, x, y)) {
    return NextResponse.json({
      status: "EMPTY",
      hash: "EMPTY",
      updatedAt: null,
      sourceIndex: null,
      hasCurrentOverride: false,
      isCleanMoonBase: false,
      timelineIndex,
    });
  }

  const timeline = await resolveTimelineContext(mapId, timelineIndex);
  const meta = await resolveEffectiveTileMeta(timeline, z, x, y);
  const currentNodeMeta = await readTimelineNodeMeta(mapId, timeline.node.id, z, x, y);
  const hasCurrentOverride = currentNodeMeta?.status === "READY" && currentNodeMeta?.tombstone !== true;
  const isCleanMoonBase = map.template === "moon" && meta.sourceIndex === null && meta.status === "READY";

  return NextResponse.json({
    status: meta.status,
    hash: meta.hash,
    updatedAt: meta.updatedAt,
    sourceIndex: meta.sourceIndex,
    hasCurrentOverride,
    isCleanMoonBase,
    timelineIndex: timeline.index,
  });
}
