import type { ModelVariant } from "../modelVariant";

export type AnchorTaskStatus = "PENDING" | "RUNNING" | "SUCCESS" | "FAILED" | "BLOCKED";
export type ParentRefreshJobStatus = "QUEUED" | "RUNNING" | "SUCCESS" | "FAILED";
export type BatchRunStatus = "IDLE" | "RUNNING" | "COMPLETING" | "COMPLETED" | "FAILED" | "CANCELLED";

export type TileCoord = {
  x: number;
  y: number;
};

export type TileBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type AnchorPriority = {
  distance: number;
  // 0: origin, 1: axis-x, 2: axis-y, 3: interior
  bucket: 0 | 1 | 2 | 3;
  // 0: NE, 1: NW, 2: SE, 3: SW, 4: fallback / non-interior
  quadrantOrder: 0 | 1 | 2 | 3 | 4;
};

export type AnchorTask = {
  id: string;
  u: number;
  v: number;
  x: number;
  y: number;
  deps: string[];
  dependents: string[];
  priority: AnchorPriority;
  status: AnchorTaskStatus;
  attempts: number;
  waveIndex?: number;
  startedAt?: number;
  finishedAt?: number;
  blockedBy?: string;
  error?: string;
};

export type WaveResult = {
  waveIndex: number;
  taskIds: string[];
  successIds: string[];
  failedIds: string[];
  blockedIds: string[];
  startedAt: number;
  finishedAt: number;
};

export type ParentRefreshJob = {
  id: string;
  waveIndex: number;
  childZ: number;
  leafTiles: TileCoord[];
  maxLevels?: number;
  status: ParentRefreshJobStatus;
  attempts: number;
  enqueuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  currentLevelZ?: number;
  error?: string;
};

export type GenerateProgress = {
  total: number;
  pending: number;
  running: number;
  success: number;
  failed: number;
  blocked: number;
  wavesCompleted: number;
};

export type ParentProgress = {
  enqueuedWaves: number;
  completedWaves: number;
  failedWaves: number;
  queueLength: number;
  runningJobs: number;
  currentLevelZ: number | null;
};

export type BatchRunState = {
  runId: string;
  status: BatchRunStatus;
  startedAt: number;
  finishedAt?: number;
  error?: string;
  prompt: string;
  modelVariant: ModelVariant;
  layers: number;
  maxParallel: number;
  origin: TileCoord;
  currentWave: number;
  coverageBounds: TileBounds | null;
  anchors: Record<string, AnchorTask>;
  waves: WaveResult[];
  parentJobs: ParentRefreshJob[];
  generate: GenerateProgress;
  parents: ParentProgress;
};
