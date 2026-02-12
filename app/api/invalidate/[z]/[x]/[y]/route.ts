import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/adapters/db.file";
import { fileQueue } from "@/lib/adapters/queue.file";
import { z as zod } from "zod";
import { DEFAULT_MODEL_VARIANT, MODEL_VARIANTS } from "@/lib/modelVariant";

const requestSchema = zod.object({
  prompt: zod.string().min(1, "Prompt is required"),
  modelVariant: zod.enum(MODEL_VARIANTS).optional(),
});

export async function POST(req: NextRequest, { params }:{params:Promise<{z:string,x:string,y:string}>}) {
  const { z: zStr, x: xStr, y: yStr } = await params;
  const z = Number(zStr), x = Number(xStr), y = Number(yStr);
  
  const body = await req.json();
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    return NextResponse.json({ error: firstError?.message || 'Invalid input' }, { status: 400 });
  }
  const { prompt, modelVariant = DEFAULT_MODEL_VARIANT } = parsed.data;
  
  const t = await db.getTile(z,x,y);
  if (!t) return NextResponse.json({ error:"Tile not found" }, { status:404 });

  await db.updateTile(z,x,y, { status:"PENDING", contentVer:(t.contentVer??0)+1 });
  await fileQueue.enqueue(`regen-${z}-${x}-${y}`, { z, x, y, prompt, modelVariant });

  return NextResponse.json({ ok:true });
}
