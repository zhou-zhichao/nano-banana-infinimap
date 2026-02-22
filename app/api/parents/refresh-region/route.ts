import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parentOf, ZMAX } from "@/lib/coords";
import { generateParentTileAtNode } from "@/lib/parentTiles";
import { isTileInBounds } from "@/lib/tilemaps/bounds";
import { MapContextError, resolveMapContext } from "@/lib/tilemaps/context";
import { parseTimelineIndexFromRequest, resolveTimelineContext } from "@/lib/timeline/context";

const coordSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
});

const requestSchema = z.object({
  childZ: z.number().int().min(1).max(ZMAX),
  childTiles: z.array(coordSchema).min(1),
});

function dedupeCoords(coords: Array<{ x: number; y: number }>) {
  const out: Array<{ x: number; y: number }> = [];
  const seen = new Set<string>();
  for (const coord of coords) {
    const key = `${coord.x},${coord.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(coord);
  }
  return out;
}

export async function POST(req: NextRequest) {
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

  try {
    const body = await req.json();
    const { childZ, childTiles } = requestSchema.parse(body);
    const timeline = await resolveTimelineContext(mapId, timelineIndex);

    const normalizedChildren = dedupeCoords(
      childTiles.filter((coord) => isTileInBounds(map, childZ, coord.x, coord.y)),
    );
    if (normalizedChildren.length === 0) {
      return NextResponse.json({
        childZ,
        parentZ: childZ - 1,
        childTileCount: 0,
        refreshedCount: 0,
        parentTiles: [],
        timelineIndex: timeline.index,
      });
    }

    const parentMap = new Map<string, { x: number; y: number }>();
    for (const child of normalizedChildren) {
      const parent = parentOf(childZ, child.x, child.y);
      if (!isTileInBounds(map, childZ - 1, parent.x, parent.y)) continue;
      parentMap.set(`${parent.x},${parent.y}`, { x: parent.x, y: parent.y });
    }

    const parentTiles = Array.from(parentMap.values());
    for (const parent of parentTiles) {
      await generateParentTileAtNode(timeline, childZ - 1, parent.x, parent.y);
    }

    return NextResponse.json({
      childZ,
      parentZ: childZ - 1,
      childTileCount: normalizedChildren.length,
      refreshedCount: parentTiles.length,
      parentTiles,
      timelineIndex: timeline.index,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request payload", details: error.issues }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to refresh parent region" },
      { status: 500 },
    );
  }
}

