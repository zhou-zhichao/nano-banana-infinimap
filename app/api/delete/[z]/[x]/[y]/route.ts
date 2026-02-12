import fs from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { childrenOf, parentOf, ZMAX } from "@/lib/coords";
import { db } from "@/lib/adapters/db.file";
import { generateParentTile } from "@/lib/parentTiles";
import { tilePath } from "@/lib/storage";
import { isTileInBounds } from "@/lib/tilemaps/bounds";
import { MapContextError, resolveMapContext } from "@/lib/tilemaps/context";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ z: string; x: string; y: string }> }) {
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

  if (z !== ZMAX) {
    return NextResponse.json({ error: "Only max zoom tiles can be deleted" }, { status: 400 });
  }
  if (!isTileInBounds(map, z, x, y)) {
    return NextResponse.json({ error: "Tile is outside map bounds" }, { status: 400 });
  }

  try {
    const targetPath = tilePath(mapId, z, x, y);
    await fs.unlink(targetPath).catch(() => {});
    await db.updateTile(mapId, z, x, y, { status: "EMPTY", hash: undefined, contentVer: 0 });

    (async () => {
      let cz = z;
      let cx = x;
      let cy = y;
      while (cz > 0) {
        const p = parentOf(cz, cx, cy);
        const kids = childrenOf(p.z, p.x, p.y);
        const buffers = await Promise.all(
          kids.map((child) => fs.readFile(tilePath(mapId, child.z, child.x, child.y)).catch(() => null)),
        );
        const hasAnyChild = buffers.some((buf) => buf !== null);
        if (hasAnyChild) {
          await generateParentTile(mapId, p.z, p.x, p.y);
        } else {
          await fs.unlink(tilePath(mapId, p.z, p.x, p.y)).catch(() => {});
          await db.updateTile(mapId, p.z, p.x, p.y, { status: "EMPTY", hash: undefined, contentVer: 0 });
        }
        cz = p.z;
        cx = p.x;
        cy = p.y;
      }
    })().catch((err) => console.error(`Error regenerating parents after delete ${z}/${x}/${y}:`, err));

    return NextResponse.json({ ok: true, message: "Tile deleted" });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to delete tile", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
