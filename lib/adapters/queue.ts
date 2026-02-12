import type { ModelVariant } from "../modelVariant";

export interface TileGenerationJobPayload {
  z: number;
  x: number;
  y: number;
  prompt: string;
  modelVariant?: ModelVariant;
}

export interface Queue {
  enqueue(name: string, payload: TileGenerationJobPayload): Promise<void>;
}
