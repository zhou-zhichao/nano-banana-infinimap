import { NextRequest, NextResponse } from "next/server";
import { generateAllParentTiles } from "@/lib/parentTiles";
import { MapContextError, resolveMapContext } from "@/lib/tilemaps/context";

export async function POST(req: NextRequest) {
  try {
    const { mapId } = await resolveMapContext(req);
    generateAllParentTiles(mapId).catch(console.error);
    return NextResponse.json({ ok: true, message: `Parent tile generation started for "${mapId}"` });
  } catch (error) {
    if (error instanceof MapContextError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      {
        error: "Failed to start parent generation",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
