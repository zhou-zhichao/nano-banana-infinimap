import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateGridPreview } from "@/lib/generator";
import { DEFAULT_MODEL_VARIANT, MODEL_VARIANTS } from "@/lib/modelVariant";
import { isTileInBounds } from "@/lib/tilemaps/bounds";
import { MapContextError, resolveMapContext } from "@/lib/tilemaps/context";
import { parseTimelineIndexFromRequest, resolveTimelineContext } from "@/lib/timeline/context";
import { PythonImageServiceError } from "@/lib/pythonImageService";

const requestSchema = z.object({
  prompt: z.string().min(1),
  modelVariant: z.enum(MODEL_VARIANTS).optional(),
});

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ z: string; x: string; y: string }> },
) {
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
    const params = await context.params;
    const zLevel = Number(params.z);
    const x = Number(params.x);
    const y = Number(params.y);

    if (!isTileInBounds(map, zLevel, x, y)) {
      return NextResponse.json({ error: "Tile is outside map bounds" }, { status: 400 });
    }

    const body = await req.json();
    const { prompt, modelVariant = DEFAULT_MODEL_VARIANT } = requestSchema.parse(body);
    const timeline = await resolveTimelineContext(mapId, timelineIndex);
    const finalComposite = await generateGridPreview(mapId, zLevel, x, y, prompt, {
      modelVariant,
      timelineNodeId: timeline.node.id,
    });

    const tempDir = path.join(process.cwd(), ".temp");
    await fs.mkdir(tempDir, { recursive: true });

    const randomId = Math.random().toString(36).slice(2, 10);
    const previewId = `preview-${Date.now()}-${randomId}`;
    const previewPath = path.join(tempDir, `${previewId}.webp`);
    const previewMetaPath = path.join(tempDir, `${previewId}.json`);
    await fs.writeFile(previewPath, finalComposite);
    await fs.writeFile(
      previewMetaPath,
      JSON.stringify(
        {
          mapId,
          z: zLevel,
          x,
          y,
          timelineNodeId: timeline.node.id,
          timelineIndex: timeline.index,
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );

    return NextResponse.json({
      previewUrl: `/api/preview/${previewId}?mapId=${encodeURIComponent(mapId)}&t=${timeline.index}`,
      previewId,
      timelineIndex: timeline.index,
    });
  } catch (error) {
    let status = 500;
    const headers: Record<string, string> = {};
    if (error instanceof z.ZodError) {
      status = 400;
    } else if (error instanceof PythonImageServiceError && error.statusCode) {
      status = error.statusCode;
      if (error.retryAfterSeconds && error.retryAfterSeconds > 0) {
        headers["Retry-After"] = String(error.retryAfterSeconds);
      }
    } else if (error instanceof Error && /python image service\s+(\d{3})/i.test(error.message)) {
      const match = error.message.match(/python image service\s+(\d{3})/i);
      if (match) status = Number(match[1]);
    }

    const message = error instanceof Error ? error.message : "Failed to edit tile";
    return NextResponse.json({ error: message }, { status, headers });
  }
}
