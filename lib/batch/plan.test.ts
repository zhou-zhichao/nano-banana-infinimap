import assert from "node:assert/strict";
import test from "node:test";
import { buildAnchorPlan, collectAnchorLeafTiles } from "./plan";

test("dependency and priority order: center -> axis-x -> axis-y -> diagonal", () => {
  const plan = buildAnchorPlan({
    originX: 20,
    originY: 20,
    layers: 1,
    mapWidth: 64,
    mapHeight: 64,
  });
  const byId = plan.byId;
  const order = plan.priorityOrder;

  const center = byId["u:0,v:0"];
  const left = byId["u:-1,v:0"];
  const right = byId["u:1,v:0"];
  const up = byId["u:0,v:-1"];
  const down = byId["u:0,v:1"];
  const ne = byId["u:1,v:-1"];

  assert.ok(center);
  assert.ok(left && right && up && down && ne);

  assert.deepEqual(left.deps, ["u:0,v:0"]);
  assert.deepEqual(right.deps, ["u:0,v:0"]);
  assert.deepEqual(up.deps, ["u:0,v:0"]);
  assert.deepEqual(down.deps, ["u:0,v:0"]);
  assert.deepEqual(ne.deps, ["u:0,v:0"]);

  const idx = (id: string) => order.indexOf(id);
  assert.ok(idx("u:0,v:0") < idx("u:-1,v:0"));
  assert.ok(idx("u:0,v:0") < idx("u:1,v:0"));
  assert.ok(idx("u:1,v:0") < idx("u:0,v:-1"));
  assert.ok(idx("u:-1,v:0") < idx("u:0,v:1"));
  assert.ok(idx("u:0,v:-1") < idx("u:1,v:-1"));
});

test("boundary-safe 3x3 expansion only returns in-bounds tiles", () => {
  const cornerLeaves = collectAnchorLeafTiles({ x: 0, y: 0 }, 3, 3);
  assert.equal(cornerLeaves.length, 4);
  for (const tile of cornerLeaves) {
    assert.ok(tile.x >= 0 && tile.y >= 0, `negative tile (${tile.x}, ${tile.y})`);
    assert.ok(tile.x < 3 && tile.y < 3, `out-of-bounds tile (${tile.x}, ${tile.y})`);
  }

  const plan = buildAnchorPlan({
    originX: 0,
    originY: 0,
    layers: 2,
    mapWidth: 4,
    mapHeight: 4,
  });
  const inside = plan.anchors.every((anchor) => anchor.x >= 0 && anchor.y >= 0 && anchor.x < 4 && anchor.y < 4);
  assert.equal(inside, true);
});

