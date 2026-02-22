import { DEFAULT_MODEL_VARIANT, type ModelVariant } from "../modelVariant";
import { anchorsOverlap3x3, buildAnchorPlan, collectAnchorLeafTiles, dedupeTileCoords } from "./plan";
import type {
  AnchorTask,
  AnchorTaskStatus,
  BatchRunState,
  GenerateProgress,
  ParentProgress,
  ParentRefreshJob,
  TileCoord,
  WaveResult,
} from "./types";

type FetchLike = typeof fetch;

type ExecuteAnchorHookContext = {
  attempt: number;
  signal: AbortSignal;
};

type RefreshParentHookRequest = {
  childZ: number;
  childTiles: TileCoord[];
  signal: AbortSignal;
};

export type StartBatchRunInput = {
  mapId: string;
  timelineIndex: number;
  z: number;
  originX: number;
  originY: number;
  mapWidth: number;
  mapHeight: number;
  layers: number;
  prompt: string;
  modelVariant?: ModelVariant;
  maxParallel?: number;
  maxGenerateRetries?: number;
  parentJobRetries?: number;
  parentWorkerConcurrency?: number;
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
  onState?: (state: BatchRunState) => void;
  executeAnchor?: (anchor: AnchorTask, ctx: ExecuteAnchorHookContext) => Promise<void>;
  refreshParentLevel?: (
    job: ParentRefreshJob,
    request: RefreshParentHookRequest,
  ) => Promise<{ parentTiles: TileCoord[] }>;
};

export type BatchRunHandle = {
  done: Promise<BatchRunState>;
  cancel: () => void;
  getState: () => BatchRunState;
};

class HttpError extends Error {
  status: number;
  retryAfterSeconds: number | null;

  constructor(message: string, status: number, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

type AnchorExecutionResult =
  | { ok: true }
  | {
      ok: false;
      error: string;
      retryAfterMs: number | null;
    };

function withMapTimeline(path: string, mapId: string, timelineIndex: number) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}mapId=${encodeURIComponent(mapId)}&t=${encodeURIComponent(String(timelineIndex))}`;
}

function createAbortError() {
  const error = new Error("Batch run aborted");
  error.name = "AbortError";
  return error;
}

function ensureNotAborted(signal: AbortSignal) {
  if (signal.aborted) {
    throw createAbortError();
  }
}

function toErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

function retryAfterMsFromUnknown(error: unknown): number | null {
  if (error instanceof HttpError && typeof error.retryAfterSeconds === "number" && error.retryAfterSeconds > 0) {
    return error.retryAfterSeconds * 1000;
  }
  return null;
}

async function sleep(ms: number, signal: AbortSignal) {
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(createAbortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function readResponseErrorMessage(response: Response, fallback: string) {
  const bodyText = await response.text().catch(() => "");
  if (!bodyText.trim()) return fallback;
  try {
    const parsed = JSON.parse(bodyText) as { error?: unknown; detail?: unknown };
    if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error.trim();
    if (typeof parsed.detail === "string" && parsed.detail.trim()) return parsed.detail.trim();
  } catch {
    // ignore JSON parse failures and fallback to raw text
  }
  return bodyText.trim() || fallback;
}

async function toHttpError(response: Response, fallback: string) {
  const retryAfterHeader = response.headers.get("retry-after");
  const retryAfter = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : NaN;
  const retryAfterSeconds = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null;
  const message = await readResponseErrorMessage(response, fallback);
  return new HttpError(message, response.status, retryAfterSeconds);
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function computeGenerateProgress(anchors: Record<string, AnchorTask>, wavesCompleted: number): GenerateProgress {
  const values = Object.values(anchors);
  let pending = 0;
  let running = 0;
  let success = 0;
  let failed = 0;
  let blocked = 0;
  for (const anchor of values) {
    if (anchor.status === "PENDING") pending += 1;
    else if (anchor.status === "RUNNING") running += 1;
    else if (anchor.status === "SUCCESS") success += 1;
    else if (anchor.status === "FAILED") failed += 1;
    else if (anchor.status === "BLOCKED") blocked += 1;
  }
  return {
    total: values.length,
    pending,
    running,
    success,
    failed,
    blocked,
    wavesCompleted,
  };
}

function computeParentProgress(parentJobs: ParentRefreshJob[]): ParentProgress {
  let completedWaves = 0;
  let failedWaves = 0;
  let queueLength = 0;
  let runningJobs = 0;
  let currentLevelZ: number | null = null;

  for (const job of parentJobs) {
    if (job.status === "SUCCESS") completedWaves += 1;
    if (job.status === "FAILED") failedWaves += 1;
    if (job.status === "QUEUED") queueLength += 1;
    if (job.status === "RUNNING") {
      runningJobs += 1;
      if (typeof job.currentLevelZ === "number") {
        if (currentLevelZ == null) currentLevelZ = job.currentLevelZ;
        else currentLevelZ = Math.min(currentLevelZ, job.currentLevelZ);
      }
    }
  }

  return {
    enqueuedWaves: parentJobs.length,
    completedWaves,
    failedWaves,
    queueLength,
    runningJobs,
    currentLevelZ,
  };
}

function cloneState(state: BatchRunState): BatchRunState {
  const anchors: Record<string, AnchorTask> = {};
  for (const [id, anchor] of Object.entries(state.anchors)) {
    anchors[id] = {
      ...anchor,
      deps: [...anchor.deps],
      dependents: [...anchor.dependents],
      priority: { ...anchor.priority },
    };
  }
  const waves: WaveResult[] = state.waves.map((wave) => ({
    ...wave,
    taskIds: [...wave.taskIds],
    successIds: [...wave.successIds],
    failedIds: [...wave.failedIds],
    blockedIds: [...wave.blockedIds],
  }));
  const parentJobs: ParentRefreshJob[] = state.parentJobs.map((job) => ({
    ...job,
    leafTiles: job.leafTiles.map((tile) => ({ ...tile })),
  }));

  return {
    ...state,
    origin: { ...state.origin },
    coverageBounds: state.coverageBounds ? { ...state.coverageBounds } : null,
    anchors,
    waves,
    parentJobs,
    generate: { ...state.generate },
    parents: { ...state.parents },
  };
}

function isTerminalStatus(status: AnchorTaskStatus) {
  return status === "SUCCESS" || status === "FAILED" || status === "BLOCKED";
}

export function startBatchRun(input: StartBatchRunInput): BatchRunHandle {
  const mapId = input.mapId;
  const timelineIndex = input.timelineIndex;
  const z = input.z;
  const prompt = input.prompt.trim();
  const modelVariant = input.modelVariant ?? DEFAULT_MODEL_VARIANT;
  const maxParallel = clampInt(input.maxParallel ?? 4, 1, 16);
  const maxGenerateRetries = clampInt(input.maxGenerateRetries ?? 3, 0, 10);
  const parentJobRetries = clampInt(input.parentJobRetries ?? 2, 0, 10);
  const parentWorkerConcurrency = clampInt(input.parentWorkerConcurrency ?? 1, 1, 4);

  const fetchImpl = input.fetchImpl ?? fetch;
  const abortController = new AbortController();
  const signal = abortController.signal;
  if (input.signal) {
    if (input.signal.aborted) {
      abortController.abort();
    } else {
      input.signal.addEventListener("abort", () => abortController.abort(), { once: true });
    }
  }

  const plan = buildAnchorPlan({
    originX: input.originX,
    originY: input.originY,
    layers: input.layers,
    mapWidth: input.mapWidth,
    mapHeight: input.mapHeight,
  });
  const anchors: Record<string, AnchorTask> = {};
  for (const anchor of plan.anchors) {
    anchors[anchor.id] = {
      ...anchor,
      deps: [...anchor.deps],
      dependents: [...anchor.dependents],
      priority: { ...anchor.priority },
    };
  }

  const state: BatchRunState = {
    runId: `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    status: "RUNNING",
    startedAt: Date.now(),
    prompt,
    modelVariant,
    layers: clampInt(input.layers, 0, 256),
    maxParallel,
    origin: { x: input.originX, y: input.originY },
    currentWave: 0,
    coverageBounds: plan.coverageBounds ? { ...plan.coverageBounds } : null,
    anchors,
    waves: [],
    parentJobs: [],
    generate: computeGenerateProgress(anchors, 0),
    parents: computeParentProgress([]),
  };

  let generationFinished = false;
  let fatalError: Error | null = null;
  const onState = input.onState;

  const emit = () => {
    state.generate = computeGenerateProgress(state.anchors, state.waves.length);
    state.parents = computeParentProgress(state.parentJobs);
    onState?.(cloneState(state));
  };

  const propagateBlockedFrom = (failedId: string): string[] => {
    const blockedIds: string[] = [];
    const queue = [...(state.anchors[failedId]?.dependents ?? [])];
    while (queue.length > 0) {
      const nextId = queue.shift()!;
      const anchor = state.anchors[nextId];
      if (!anchor) continue;
      if (anchor.status !== "PENDING") continue;
      anchor.status = "BLOCKED";
      anchor.blockedBy = failedId;
      anchor.finishedAt = Date.now();
      blockedIds.push(nextId);
      queue.push(...anchor.dependents);
    }
    return blockedIds;
  };

  const selectReadyAnchorIds = (): string[] => {
    const ready: string[] = [];
    for (const id of plan.priorityOrder) {
      const anchor = state.anchors[id];
      if (!anchor || anchor.status !== "PENDING") continue;
      const depsReady = anchor.deps.every((depId) => state.anchors[depId]?.status === "SUCCESS");
      if (depsReady) ready.push(id);
    }
    return ready;
  };

  const pickWaveAnchorIds = (readyIds: string[]): string[] => {
    const selected: string[] = [];
    for (const id of readyIds) {
      if (selected.length >= maxParallel) break;
      const candidate = state.anchors[id];
      if (!candidate) continue;
      const conflicts = selected.some((selectedId) => {
        const selectedAnchor = state.anchors[selectedId];
        if (!selectedAnchor) return false;
        return anchorsOverlap3x3(candidate, selectedAnchor);
      });
      if (conflicts) continue;
      selected.push(id);
    }
    if (selected.length === 0 && readyIds.length > 0) {
      selected.push(readyIds[0]);
    }
    return selected;
  };

  const runAnchorOverApi = async (anchor: AnchorTask): Promise<void> => {
    ensureNotAborted(signal);
    let previewId: string | null = null;
    try {
      const editResponse = await fetchImpl(withMapTimeline(`/api/edit-tile/${z}/${anchor.x}/${anchor.y}`, mapId, timelineIndex), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, modelVariant }),
        signal,
      });
      if (!editResponse.ok) {
        throw await toHttpError(editResponse, "Failed to edit tile");
      }
      const editJson = (await editResponse.json().catch(() => ({}))) as { previewId?: unknown };
      previewId = typeof editJson.previewId === "string" ? editJson.previewId : null;
      if (!previewId) {
        throw new Error("Invalid /api/edit-tile response: missing previewId");
      }

      const previewUrl = withMapTimeline(`/api/preview/${previewId}`, mapId, timelineIndex);
      const confirmResponse = await fetchImpl(
        withMapTimeline(`/api/confirm-edit/${z}/${anchor.x}/${anchor.y}`, mapId, timelineIndex),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            previewUrl,
            previewMode: "blended",
            skipParentRefresh: true,
          }),
          signal,
        },
      );
      if (!confirmResponse.ok) {
        throw await toHttpError(confirmResponse, "Failed to confirm edit");
      }
    } finally {
      if (previewId) {
        await fetchImpl(withMapTimeline(`/api/preview/${previewId}`, mapId, timelineIndex), {
          method: "DELETE",
          signal,
        }).catch(() => null);
      }
    }
  };

  const runAnchorWithRetry = async (anchor: AnchorTask): Promise<AnchorExecutionResult> => {
    const maxAttempts = maxGenerateRetries + 1;
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      ensureNotAborted(signal);
      anchor.attempts = attempt;
      try {
        if (input.executeAnchor) {
          await input.executeAnchor(anchor, { attempt, signal });
        } else {
          await runAnchorOverApi(anchor);
        }
        return { ok: true };
      } catch (error) {
        if (signal.aborted) {
          throw createAbortError();
        }
        lastError = error;
        if (attempt >= maxAttempts) break;
        const retryAfterMs = retryAfterMsFromUnknown(error);
        const delayMs = retryAfterMs ?? Math.min(15_000, 500 * 2 ** (attempt - 1));
        await sleep(delayMs, signal);
      }
    }
    return {
      ok: false,
      error: toErrorMessage(lastError, "Anchor execution failed"),
      retryAfterMs: retryAfterMsFromUnknown(lastError),
    };
  };

  const enqueueParentRefreshJob = (waveIndex: number, successIds: string[]) => {
    if (successIds.length === 0) return;
    const leaves: TileCoord[] = [];
    for (const id of successIds) {
      const anchor = state.anchors[id];
      if (!anchor) continue;
      leaves.push(...collectAnchorLeafTiles(anchor, input.mapWidth, input.mapHeight));
    }
    const dedupedLeaves = dedupeTileCoords(leaves);
    if (dedupedLeaves.length === 0) return;

    const job: ParentRefreshJob = {
      id: `parents-${waveIndex}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      waveIndex,
      childZ: z,
      leafTiles: dedupedLeaves,
      status: "QUEUED",
      attempts: 0,
      enqueuedAt: Date.now(),
    };
    state.parentJobs.push(job);
    emit();
  };

  const refreshParentLevelOverApi = async (
    childZ: number,
    childTiles: TileCoord[],
  ): Promise<{ parentTiles: TileCoord[] }> => {
    const response = await fetchImpl(withMapTimeline("/api/parents/refresh-region", mapId, timelineIndex), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ childZ, childTiles }),
      signal,
    });
    if (!response.ok) {
      throw await toHttpError(response, `Failed parent refresh at child level z=${childZ}`);
    }
    const json = (await response.json().catch(() => ({}))) as { parentTiles?: unknown };
    const parentTilesRaw = Array.isArray(json.parentTiles) ? json.parentTiles : [];
    const parentTiles: TileCoord[] = [];
    for (const item of parentTilesRaw) {
      const x = Number((item as any)?.x);
      const y = Number((item as any)?.y);
      if (!Number.isInteger(x) || !Number.isInteger(y)) continue;
      parentTiles.push({ x, y });
    }
    return { parentTiles: dedupeTileCoords(parentTiles) };
  };

  const runParentJob = async (job: ParentRefreshJob) => {
    let childZ = job.childZ;
    let childTiles = [...job.leafTiles];

    while (childZ > 0 && childTiles.length > 0) {
      ensureNotAborted(signal);
      job.currentLevelZ = childZ - 1;
      emit();

      const result = input.refreshParentLevel
        ? await input.refreshParentLevel(job, { childZ, childTiles, signal })
        : await refreshParentLevelOverApi(childZ, childTiles);
      childTiles = dedupeTileCoords(result.parentTiles);
      childZ -= 1;
    }
    job.currentLevelZ = undefined;
  };

  const parentWorkerLoop = async () => {
    while (true) {
      if (fatalError) return;
      ensureNotAborted(signal);
      const queuedJob = state.parentJobs.find((job) => job.status === "QUEUED");
      if (!queuedJob) {
        const hasRunningOrQueued = state.parentJobs.some((job) => job.status === "RUNNING" || job.status === "QUEUED");
        if (generationFinished && !hasRunningOrQueued) {
          return;
        }
        await sleep(120, signal);
        continue;
      }

      queuedJob.status = "RUNNING";
      queuedJob.startedAt = Date.now();
      queuedJob.attempts += 1;
      queuedJob.error = undefined;
      emit();

      try {
        await runParentJob(queuedJob);
        queuedJob.status = "SUCCESS";
        queuedJob.finishedAt = Date.now();
        queuedJob.currentLevelZ = undefined;
        emit();
      } catch (error) {
        if (signal.aborted) return;
        const retryAfterMs = retryAfterMsFromUnknown(error);
        queuedJob.error = toErrorMessage(error, "Parent refresh failed");
        queuedJob.currentLevelZ = undefined;
        const maxAttempts = parentJobRetries + 1;
        if (queuedJob.attempts < maxAttempts) {
          queuedJob.status = "QUEUED";
          emit();
          const delayMs = retryAfterMs ?? Math.min(15_000, 750 * 2 ** (queuedJob.attempts - 1));
          await sleep(delayMs, signal);
          continue;
        }

        queuedJob.status = "FAILED";
        queuedJob.finishedAt = Date.now();
        fatalError = new Error(`Parent refresh failed (wave ${queuedJob.waveIndex}): ${queuedJob.error}`);
        emit();
        abortController.abort();
        return;
      }
    }
  };

  const parentWorkers = Array.from({ length: parentWorkerConcurrency }, () => parentWorkerLoop());

  const done = (async (): Promise<BatchRunState> => {
    emit();
    try {
      while (true) {
        ensureNotAborted(signal);
        if (fatalError) throw fatalError;

        const pendingAnchors = Object.values(state.anchors).filter((anchor) => anchor.status === "PENDING");
        if (pendingAnchors.length === 0) {
          break;
        }

        let blockedAny = false;
        for (const anchor of pendingAnchors) {
          const blocker = anchor.deps.find((depId) => {
            const depStatus = state.anchors[depId]?.status;
            return depStatus === "FAILED" || depStatus === "BLOCKED";
          });
          if (!blocker) continue;
          anchor.status = "BLOCKED";
          anchor.blockedBy = blocker;
          anchor.finishedAt = Date.now();
          blockedAny = true;
        }
        if (blockedAny) {
          emit();
          continue;
        }

        const readyIds = selectReadyAnchorIds();
        if (readyIds.length === 0) {
          // Safety: any remaining pending tasks are no longer reachable.
          for (const anchor of pendingAnchors) {
            if (anchor.status !== "PENDING") continue;
            anchor.status = "BLOCKED";
            anchor.blockedBy = anchor.deps[0];
            anchor.finishedAt = Date.now();
          }
          emit();
          continue;
        }

        const waveIds = pickWaveAnchorIds(readyIds);
        if (waveIds.length === 0) {
          await sleep(25, signal);
          continue;
        }

        const waveIndex = state.currentWave + 1;
        state.currentWave = waveIndex;
        const waveStartedAt = Date.now();
        for (const id of waveIds) {
          const anchor = state.anchors[id];
          if (!anchor) continue;
          anchor.status = "RUNNING";
          anchor.waveIndex = waveIndex;
          anchor.startedAt = waveStartedAt;
        }
        emit();

        const outcomes = await Promise.all(
          waveIds.map(async (id) => {
            const anchor = state.anchors[id];
            if (!anchor) {
              return {
                id,
                result: {
                  ok: false,
                  error: "Anchor not found",
                  retryAfterMs: null,
                } as AnchorExecutionResult,
              };
            }
            const result = await runAnchorWithRetry(anchor);
            return { id, result };
          }),
        );

        const waveFinishedAt = Date.now();
        const successIds: string[] = [];
        const failedIds: string[] = [];
        const blockedIds: string[] = [];
        for (const outcome of outcomes) {
          const anchor = state.anchors[outcome.id];
          if (!anchor) continue;
          anchor.finishedAt = waveFinishedAt;
          if (outcome.result.ok) {
            anchor.status = "SUCCESS";
            anchor.error = undefined;
            successIds.push(anchor.id);
            continue;
          }
          anchor.status = "FAILED";
          anchor.error = outcome.result.error;
          failedIds.push(anchor.id);
          blockedIds.push(...propagateBlockedFrom(anchor.id));
        }

        const uniqueBlocked = Array.from(new Set(blockedIds));
        state.waves.push({
          waveIndex,
          taskIds: [...waveIds],
          successIds,
          failedIds,
          blockedIds: uniqueBlocked,
          startedAt: waveStartedAt,
          finishedAt: waveFinishedAt,
        });
        emit();
        enqueueParentRefreshJob(waveIndex, successIds);
      }

      generationFinished = true;
      state.status = "COMPLETING";
      emit();
      await Promise.all(parentWorkers);

      if (fatalError) throw fatalError;
      ensureNotAborted(signal);
      state.status = "COMPLETED";
      state.finishedAt = Date.now();
      emit();
      return cloneState(state);
    } catch (error) {
      generationFinished = true;
      if (fatalError || (!signal.aborted && error instanceof Error && error.name !== "AbortError")) {
        state.status = "FAILED";
        state.error = fatalError ? fatalError.message : toErrorMessage(error, "Batch run failed");
      } else {
        state.status = "CANCELLED";
        state.error = toErrorMessage(error, "Batch run cancelled");
      }
      state.finishedAt = Date.now();
      emit();
      abortController.abort();
      await Promise.allSettled(parentWorkers);
      return cloneState(state);
    }
  })();

  return {
    done,
    cancel: () => {
      abortController.abort();
    },
    getState: () => cloneState(state),
  };
}
