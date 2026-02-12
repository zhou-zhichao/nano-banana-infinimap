import { DEFAULT_MODEL_VARIANT, ModelVariant } from "./modelVariant";

const DEFAULT_STANDARD_MODEL = "gemini-2.5-flash-image";
const DEFAULT_PRO_MODEL = "gemini-3-pro-image-preview";

function envValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function resolveVertexModelForVariant(
  modelVariant: ModelVariant = DEFAULT_MODEL_VARIANT,
): string {
  if (modelVariant === "nano_banana_pro") {
    return envValue("VERTEX_MODEL_PRO") ?? DEFAULT_PRO_MODEL;
  }
  return envValue("VERTEX_MODEL") ?? DEFAULT_STANDARD_MODEL;
}
