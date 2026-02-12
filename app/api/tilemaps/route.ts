import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureTilemapsBootstrap } from "@/lib/tilemaps/bootstrap";
import { createTilemap, listTilemaps } from "@/lib/tilemaps/service";

const CreateBody = z
  .object({
    name: z.string().min(1).max(80),
    template: z.enum(["blank", "moon"]),
    width: z.number().int().min(1).max(256).optional(),
    height: z.number().int().min(1).max(256).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.template === "blank" && (!value.width || !value.height)) {
      ctx.addIssue({
        code: "custom",
        message: "Blank template requires width and height",
      });
    }
  });

export async function GET() {
  await ensureTilemapsBootstrap();
  const items = await listTilemaps();
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  await ensureTilemapsBootstrap();
  const body = await req.json().catch(() => ({}));
  const parsed = CreateBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  try {
    const created = await createTilemap(parsed.data);
    return NextResponse.json({ item: created }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create tilemap";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
