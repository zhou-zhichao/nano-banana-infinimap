import { NextResponse } from "next/server";
import { db } from "@/lib/adapters/db.file";
import { isTileInBounds } from "@/lib/tilemaps/bounds";
import { MapContextError, resolveMapContext } from "@/lib/tilemaps/context";

export async function GET(req: Request, { params }:{params:Promise<{z:string,x:string,y:string}>}) {
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
  const z = Number(zStr), x = Number(xStr), y = Number(yStr);
  if (!isTileInBounds(map, z, x, y)) {
    return NextResponse.json({ status: "EMPTY", hash: "EMPTY", updatedAt: null });
  }

  const t = await db.getTile(mapId, z, x, y);
  return NextResponse.json({
    status: t?.status ?? "EMPTY",
    hash: t?.hash ?? "EMPTY",
    updatedAt: t?.updatedAt ?? null
  });
}
