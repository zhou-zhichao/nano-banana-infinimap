import assert from "node:assert/strict";
import test from "node:test";
import { startBatchRun, type StartBatchRunInput } from "./executor";
import { anchorsOverlap3x3 } from "./plan";
import type { AnchorTask, BatchRunState, TileCoord } from "./types";

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function createBaseInput(overrides: Partial<StartBatchRunInput> = {}): StartBatchRunInput {
  return {
    mapId: "test-map",
    timelineIndex: 1,
    z: 2,
    originX: 20,
    originY: 20,
    mapWidth: 64,
    mapHeight: 64,
    layers: 2,
    prompt: "batch test",
    maxParallel: 4,
    ...overrides,
  };
}

test("parallel wave never schedules overlapping 3x3 anchors", async () => {
  const handle = startBatchRun(
    createBaseInput({
      executeAnchor: async () => {
        await delay(5);
      },
      refreshParentLevel: async () => ({ parentTiles: [] as TileCoord[] }),
    }),
  );
  const finalState = await handle.done;
  assert.equal(finalState.status, "COMPLETED");

  for (const wave of finalState.waves) {
    const anchors = wave.taskIds.map((id) => finalState.anchors[id]).filter(Boolean);
    for (let i = 0; i < anchors.length; i++) {
      for (let j = i + 1; j < anchors.length; j++) {
        assert.equal(
          anchorsOverlap3x3(anchors[i], anchors[j]),
          false,
          `wave ${wave.waveIndex} has overlapping anchors: ${anchors[i].id} vs ${anchors[j].id}`,
        );
      }
    }
  }
});

test("wave N+1 can start while wave N parent refresh is still running", async () => {
  const handle = startBatchRun(
    createBaseInput({
      maxParallel: 1,
      executeAnchor: async () => {
        await delay(20);
      },
      refreshParentLevel: async () => {
        await delay(180);
        return { parentTiles: [] as TileCoord[] };
      },
    }),
  );
  const finalState = await handle.done;
  assert.equal(finalState.status, "COMPLETED");
  assert.ok(finalState.waves.length >= 2, "need at least two waves");

  const firstJob = finalState.parentJobs.find((job) => job.waveIndex === 1);
  assert.ok(firstJob?.finishedAt, "wave 1 parent job should finish");
  assert.ok(finalState.waves[1].startedAt < (firstJob?.finishedAt ?? 0));
});

test("batch completion waits for parent queue drain after generation is done", async () => {
  const snapshots: BatchRunState[] = [];
  const handle = startBatchRun(
    createBaseInput({
      layers: 1,
      executeAnchor: async () => {
        await delay(5);
      },
      refreshParentLevel: async () => {
        await delay(120);
        return { parentTiles: [] as TileCoord[] };
      },
      onState: (state: BatchRunState) => snapshots.push(state),
    }),
  );
  const finalState = await handle.done;
  assert.equal(finalState.status, "COMPLETED");

  const foundIntermediate = snapshots.some(
    (state) =>
      state.generate.pending === 0 &&
      state.generate.running === 0 &&
      (state.parents.runningJobs > 0 || state.parents.queueLength > 0) &&
      state.status !== "COMPLETED",
  );
  assert.equal(foundIntermediate, true);
});

test("failed anchor blocks downstream dependents", async () => {
  const handle = startBatchRun(
    createBaseInput({
      maxGenerateRetries: 0,
      executeAnchor: async (anchor: AnchorTask) => {
        if (anchor.id === "u:1,v:0") {
          throw new Error("intentional failure");
        }
      },
      refreshParentLevel: async () => ({ parentTiles: [] as TileCoord[] }),
    }),
  );
  const finalState = await handle.done;
  assert.equal(finalState.anchors["u:1,v:0"]?.status, "FAILED");
  assert.equal(finalState.anchors["u:2,v:0"]?.status, "BLOCKED");
});

test("parent refresh hard failure transitions batch to FAILED after retries", async () => {
  const handle = startBatchRun(
    createBaseInput({
      layers: 1,
      parentJobRetries: 0,
      executeAnchor: async () => {
        await delay(1);
      },
      refreshParentLevel: async () => {
        throw new Error("parent refresh failure");
      },
    }),
  );
  const finalState = await handle.done;
  assert.equal(finalState.status, "FAILED");
  assert.ok(finalState.parents.failedWaves >= 1);
});

test("parent refresh can recover on retry", async () => {
  let transientFailed = false;
  const handle = startBatchRun(
    createBaseInput({
      layers: 1,
      parentJobRetries: 1,
      executeAnchor: async () => {
        await delay(1);
      },
      refreshParentLevel: async () => {
        if (!transientFailed) {
          transientFailed = true;
          throw new Error("transient parent refresh failure");
        }
        return { parentTiles: [] as TileCoord[] };
      },
    }),
  );
  const finalState = await handle.done;
  assert.equal(finalState.status, "COMPLETED");
  assert.ok(finalState.parentJobs.some((job) => job.attempts >= 2));
});
