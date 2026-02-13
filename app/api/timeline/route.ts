import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { MapContextError, resolveMapContext } from "@/lib/tilemaps/context";
import {
  DEFAULT_TIMELINE_NODE_COUNT,
  MIN_TIMELINE_NODES,
  deleteTimelineNodeAt,
  getTimelineManifest,
  insertTimelineNodeAfter,
} from "@/lib/timeline/manifest";

const insertSchema = z.object({
  afterIndex: z.number().int().min(1),
});

const deleteSchema = z.object({
  index: z.number().int().min(1),
});

function serialize(mapId: string, manifest: Awaited<ReturnType<typeof getTimelineManifest>>) {
  return {
    mapId,
    minNodes: MIN_TIMELINE_NODES,
    defaultNodeCount: DEFAULT_TIMELINE_NODE_COUNT,
    count: manifest.nodes.length,
    nodes: manifest.nodes.map((node, idx) => ({
      index: idx + 1,
      id: node.id,
      createdAt: node.createdAt,
    })),
    updatedAt: manifest.updatedAt,
  };
}

export async function GET(req: NextRequest) {
  try {
    const { mapId } = await resolveMapContext(req);
    const manifest = await getTimelineManifest(mapId);
    return NextResponse.json(serialize(mapId, manifest));
  } catch (error) {
    if (error instanceof MapContextError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Failed to load timeline" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = insertSchema.safeParse(body);
  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    return NextResponse.json({ error: firstError?.message ?? "Invalid input" }, { status: 400 });
  }

  try {
    const { mapId } = await resolveMapContext(req);
    const { manifest, insertedIndex } = await insertTimelineNodeAfter(mapId, parsed.data.afterIndex);
    return NextResponse.json({
      ok: true,
      insertedIndex,
      ...serialize(mapId, manifest),
    });
  } catch (error) {
    if (error instanceof MapContextError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to insert timeline node" },
      { status: 400 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    return NextResponse.json({ error: firstError?.message ?? "Invalid input" }, { status: 400 });
  }

  try {
    const { mapId } = await resolveMapContext(req);
    const { manifest } = await deleteTimelineNodeAt(mapId, parsed.data.index);
    return NextResponse.json({
      ok: true,
      activeIndex: Math.min(parsed.data.index, manifest.nodes.length),
      ...serialize(mapId, manifest),
    });
  } catch (error) {
    if (error instanceof MapContextError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete timeline node" },
      { status: 400 },
    );
  }
}
