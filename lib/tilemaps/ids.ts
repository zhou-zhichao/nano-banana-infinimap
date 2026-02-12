const MAP_ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function isValidMapId(mapId: string) {
  return MAP_ID_RE.test(mapId);
}

export function slugifyMapId(input: string) {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
  if (!normalized) return "map";
  return normalized.slice(0, 63).replace(/-+$/g, "") || "map";
}
