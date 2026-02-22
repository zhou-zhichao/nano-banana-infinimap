import type { AnchorPriority, AnchorTask, TileBounds, TileCoord } from "./types";

export type BuildAnchorPlanInput = {
  originX: number;
  originY: number;
  layers: number;
  mapWidth: number;
  mapHeight: number;
};

export type AnchorPlan = {
  anchors: AnchorTask[];
  byId: Record<string, AnchorTask>;
  priorityOrder: string[];
  coverageBounds: TileBounds | null;
};

function inBounds(x: number, y: number, width: number, height: number) {
  return x >= 0 && y >= 0 && x < width && y < height;
}

export function anchorIdFromUV(u: number, v: number) {
  return `u:${u},v:${v}`;
}

function stepTowardZero(value: number) {
  if (value === 0) return 0;
  return value - Math.sign(value);
}

function priorityForAnchor(u: number, v: number): AnchorPriority {
  const distance = Math.abs(u) + Math.abs(v);
  if (u === 0 && v === 0) {
    return { distance, bucket: 0, quadrantOrder: 4 };
  }
  if (v === 0) {
    return { distance, bucket: 1, quadrantOrder: 4 };
  }
  if (u === 0) {
    return { distance, bucket: 2, quadrantOrder: 4 };
  }
  if (u > 0 && v < 0) {
    return { distance, bucket: 3, quadrantOrder: 0 };
  }
  if (u < 0 && v < 0) {
    return { distance, bucket: 3, quadrantOrder: 1 };
  }
  if (u > 0 && v > 0) {
    return { distance, bucket: 3, quadrantOrder: 2 };
  }
  if (u < 0 && v > 0) {
    return { distance, bucket: 3, quadrantOrder: 3 };
  }
  return { distance, bucket: 3, quadrantOrder: 4 };
}

export function compareAnchorsByPriority(a: AnchorTask, b: AnchorTask) {
  if (a.priority.distance !== b.priority.distance) {
    return a.priority.distance - b.priority.distance;
  }
  if (a.priority.bucket !== b.priority.bucket) {
    return a.priority.bucket - b.priority.bucket;
  }

  if (a.priority.bucket === 1) {
    const absA = Math.abs(a.u);
    const absB = Math.abs(b.u);
    if (absA !== absB) return absA - absB;
    if (a.u !== b.u) return a.u - b.u;
  }

  if (a.priority.bucket === 2) {
    const absA = Math.abs(a.v);
    const absB = Math.abs(b.v);
    if (absA !== absB) return absA - absB;
    if (a.v !== b.v) return a.v - b.v;
  }

  if (a.priority.bucket === 3) {
    if (a.priority.quadrantOrder !== b.priority.quadrantOrder) {
      return a.priority.quadrantOrder - b.priority.quadrantOrder;
    }
    const ringA = Math.max(Math.abs(a.u), Math.abs(a.v));
    const ringB = Math.max(Math.abs(b.u), Math.abs(b.v));
    if (ringA !== ringB) return ringA - ringB;
    const absUA = Math.abs(a.u);
    const absUB = Math.abs(b.u);
    if (absUA !== absUB) return absUA - absUB;
  }

  if (a.v !== b.v) return a.v - b.v;
  if (a.u !== b.u) return a.u - b.u;
  return a.id.localeCompare(b.id);
}

export function anchorsOverlap3x3(a: Pick<AnchorTask, "x" | "y">, b: Pick<AnchorTask, "x" | "y">) {
  return Math.abs(a.x - b.x) <= 2 && Math.abs(a.y - b.y) <= 2;
}

export function collectAnchorLeafTiles(
  anchor: Pick<AnchorTask, "x" | "y">,
  mapWidth: number,
  mapHeight: number,
): TileCoord[] {
  const output: TileCoord[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const tileX = anchor.x + dx;
      const tileY = anchor.y + dy;
      if (!inBounds(tileX, tileY, mapWidth, mapHeight)) continue;
      output.push({ x: tileX, y: tileY });
    }
  }
  return output;
}

function mergeCoverageBounds(
  current: TileBounds | null,
  tiles: TileCoord[],
): TileBounds | null {
  if (tiles.length === 0) return current;
  let next = current
    ? { ...current }
    : {
        minX: tiles[0].x,
        maxX: tiles[0].x,
        minY: tiles[0].y,
        maxY: tiles[0].y,
      };
  for (const tile of tiles) {
    if (tile.x < next.minX) next.minX = tile.x;
    if (tile.x > next.maxX) next.maxX = tile.x;
    if (tile.y < next.minY) next.minY = tile.y;
    if (tile.y > next.maxY) next.maxY = tile.y;
  }
  return next;
}

export function buildAnchorPlan(input: BuildAnchorPlanInput): AnchorPlan {
  const layers = Math.max(0, Math.floor(input.layers));
  const anchors: AnchorTask[] = [];
  const byId: Record<string, AnchorTask> = {};

  for (let v = -layers; v <= layers; v++) {
    for (let u = -layers; u <= layers; u++) {
      const x = input.originX + 2 * u;
      const y = input.originY + 2 * v;
      if (!inBounds(x, y, input.mapWidth, input.mapHeight)) continue;

      const id = anchorIdFromUV(u, v);
      const anchor: AnchorTask = {
        id,
        u,
        v,
        x,
        y,
        deps: [],
        dependents: [],
        priority: priorityForAnchor(u, v),
        status: "PENDING",
        attempts: 0,
      };
      anchors.push(anchor);
      byId[id] = anchor;
    }
  }

  for (const anchor of anchors) {
    if (anchor.u === 0 && anchor.v === 0) continue;
    const depU = stepTowardZero(anchor.u);
    const depV = stepTowardZero(anchor.v);
    const depId = anchorIdFromUV(depU, depV);
    if (!byId[depId] || depId === anchor.id) continue;
    anchor.deps.push(depId);
  }

  for (const anchor of anchors) {
    for (const depId of anchor.deps) {
      const dep = byId[depId];
      if (!dep) continue;
      dep.dependents.push(anchor.id);
    }
  }

  const sorted = anchors.slice().sort(compareAnchorsByPriority);
  let coverageBounds: TileBounds | null = null;
  for (const anchor of anchors) {
    const leaves = collectAnchorLeafTiles(anchor, input.mapWidth, input.mapHeight);
    coverageBounds = mergeCoverageBounds(coverageBounds, leaves);
  }

  return {
    anchors: sorted,
    byId,
    priorityOrder: sorted.map((anchor) => anchor.id),
    coverageBounds,
  };
}

export function dedupeTileCoords(coords: TileCoord[]): TileCoord[] {
  const out: TileCoord[] = [];
  const seen = new Set<string>();
  for (const coord of coords) {
    const key = `${coord.x},${coord.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(coord);
  }
  return out;
}

