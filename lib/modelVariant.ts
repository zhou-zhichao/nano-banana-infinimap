export const MODEL_VARIANTS = ["nano_banana", "nano_banana_pro"] as const;

export type ModelVariant = (typeof MODEL_VARIANTS)[number];

export const DEFAULT_MODEL_VARIANT: ModelVariant = "nano_banana";

export const MODEL_VARIANT_LABELS: Record<ModelVariant, string> = {
  nano_banana: "Nano Banana",
  nano_banana_pro: "Nano Banana Pro",
};
