import { NextRequest, NextResponse } from "next/server";
import { z as zod } from "zod";
import { db } from "@/lib/adapters/db.file";
import { fileQueue } from "@/lib/adapters/queue.file";
import { DEFAULT_MODEL_VARIANT, MODEL_VARIANTS } from "@/lib/modelVariant";
import { isTileInBounds } from "@/lib/tilemaps/bounds";
import { MapContextError, resolveMapContext } from "@/lib/tilemaps/context";

const requestSchema = zod.object({
  prompt: zod.string().min(1, "Prompt is required"),
  modelVariant: zod.enum(MODEL_VARIANTS).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ z: string; x: string; y: string }> }) {
  let mapId = "default";
  let map: any = null;
  try {
    const resolved = await resolveMapContext(req);
    mapId = resolved.mapId;
    map = resolved.map;
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
  if (!isTileInBounds(map, z, x, y)) return NextResponse.json({ error: "Tile is outside map bounds" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid input" }, { status: 400 });
  }
  const { prompt, modelVariant = DEFAULT_MODEL_VARIANT } = parsed.data;

  const t = await db.getTile(mapId, z, x, y);
  if (!t) return NextResponse.json({ error: "Tile not found" }, { status: 404 });

  await db.updateTile(mapId, z, x, y, { status: "PENDING", contentVer: (t.contentVer ?? 0) + 1 });
  await fileQueue.enqueue(`regen-${z}-${x}-${y}`, { mapId, z, x, y, prompt, modelVariant });

  return NextResponse.json({ ok: true });
}
