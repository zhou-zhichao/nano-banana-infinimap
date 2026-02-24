"use client";

import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { MODEL_VARIANT_LABELS, type ModelVariant } from "@/lib/modelVariant";

const TILE_SIZE = 256;
const CONTEXT_SPAN = 5;
const CENTER_SPAN = 3;
const CENTER_INSERT_OFFSET = 1;

export type BatchReviewModalItem = {
  anchorId: string;
  x: number;
  y: number;
  z: number;
  previewId: string;
  timelineIndex: number;
  modelVariant: ModelVariant;
};

type BatchReviewModalProps = {
  open: boolean;
  mapId: string;
  item: BatchReviewModalItem | null;
  pendingCount: number;
  busy?: boolean;
  onAccept: () => void | Promise<void>;
  onReject: () => void | Promise<void>;
  onCancelBatch: () => void;
};

function buildGridUrls(mapId: string, timelineIndex: number, z: number, centerX: number, centerY: number): string[][] {
  const stamp = Date.now();
  const rows: string[][] = [];
  for (let dy = -2; dy <= 2; dy++) {
    const row: string[] = [];
    for (let dx = -2; dx <= 2; dx++) {
      row.push(
        `/api/tiles/${z}/${centerX + dx}/${centerY + dy}?mapId=${encodeURIComponent(mapId)}&t=${encodeURIComponent(
          String(timelineIndex),
        )}&v=${stamp}`,
      );
    }
    rows.push(row);
  }
  return rows;
}

function compose5x5WithCenter(base5x5: string[][], center3x3: string[][] | null): string[][] {
  const composed = base5x5.map((row) => row.slice());
  if (!center3x3) return composed;
  for (let dy = 0; dy < CENTER_SPAN; dy++) {
    for (let dx = 0; dx < CENTER_SPAN; dx++) {
      const source = center3x3[dy]?.[dx];
      if (!source) continue;
      composed[dy + CENTER_INSERT_OFFSET][dx + CENTER_INSERT_OFFSET] = source;
    }
  }
  return composed;
}

async function extractTilesFromComposite(compositeUrl: string, signal?: AbortSignal): Promise<string[][]> {
  const response = await fetch(compositeUrl, { cache: "no-store", signal });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text.trim() || `Preview request failed (HTTP ${response.status})`);
  }

  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (!contentType.startsWith("image/")) {
    throw new Error(`Expected image response, got ${contentType || "unknown content-type"}`);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  let img: HTMLImageElement;
  try {
    img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const decoded = new Image();
      decoded.onload = () => resolve(decoded);
      decoded.onerror = () => reject(new Error("Preview image decode failed"));
      decoded.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }

  const expectedSize = TILE_SIZE * CENTER_SPAN;
  const scaleX = img.width / expectedSize;
  const scaleY = img.height / expectedSize;
  const extracted: string[][] = [];

  for (let dy = 0; dy < CENTER_SPAN; dy++) {
    const row: string[] = [];
    for (let dx = 0; dx < CENTER_SPAN; dx++) {
      const canvas = document.createElement("canvas");
      canvas.width = TILE_SIZE;
      canvas.height = TILE_SIZE;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Preview image decode failed");

      const sx = dx * TILE_SIZE * scaleX;
      const sy = dy * TILE_SIZE * scaleY;
      const sw = TILE_SIZE * scaleX;
      const sh = TILE_SIZE * scaleY;

      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, TILE_SIZE, TILE_SIZE);
      row.push(canvas.toDataURL("image/webp"));
    }
    extracted.push(row);
  }

  return extracted;
}

function TileGrid({
  title,
  subtitle,
  tiles,
  sizeClass,
}: {
  title: string;
  subtitle?: string;
  tiles: string[][];
  sizeClass: string;
}) {
  const columns = tiles[0]?.length ?? 0;
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-2">
      <div className="mb-1.5">
        <div className="text-xs font-semibold text-gray-900">{title}</div>
        {subtitle && <div className="text-[11px] text-gray-500">{subtitle}</div>}
      </div>
      <div className={`mx-auto overflow-hidden rounded-md bg-black/5 ${sizeClass}`}>
        <div
          className="grid h-full w-full gap-0"
          style={{ gridTemplateColumns: `repeat(${Math.max(columns, 1)}, minmax(0, 1fr))` }}
        >
          {tiles.flatMap((row, dy) =>
            row.map((tile, dx) => (
              <img
                key={`${dx}-${dy}-${tile.slice(0, 32)}`}
                src={tile}
                alt={`${title} tile ${dx},${dy}`}
                className="h-full w-full object-cover"
              />
            )),
          )}
        </div>
      </div>
    </div>
  );
}

export default function BatchReviewModal({
  open,
  mapId,
  item,
  pendingCount,
  busy = false,
  onAccept,
  onReject,
  onCancelBatch,
}: BatchReviewModalProps) {
  const [contextTiles5x5, setContextTiles5x5] = useState<string[][]>([]);
  const [rawCenter3x3, setRawCenter3x3] = useState<string[][] | null>(null);
  const [blendedCenter3x3, setBlendedCenter3x3] = useState<string[][] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !item) return;
    let cancelled = false;
    const controller = new AbortController();

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const context = buildGridUrls(mapId, item.timelineIndex, item.z, item.x, item.y);
        if (!cancelled) setContextTiles5x5(context);

        const [rawTiles, blendedTiles] = await Promise.all([
          extractTilesFromComposite(
            `/api/preview/${item.previewId}?mapId=${encodeURIComponent(mapId)}&t=${encodeURIComponent(
              String(item.timelineIndex),
            )}`,
            controller.signal,
          ),
          extractTilesFromComposite(
            `/api/preview/${item.previewId}?mapId=${encodeURIComponent(mapId)}&t=${encodeURIComponent(
              String(item.timelineIndex),
            )}&mode=blended`,
            controller.signal,
          ),
        ]);
        if (cancelled) return;
        setRawCenter3x3(rawTiles);
        setBlendedCenter3x3(blendedTiles);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load review images");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    setRawCenter3x3(null);
    setBlendedCenter3x3(null);
    void load();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [item, mapId, open]);

  const originalCenter3x3 = useMemo(() => {
    if (contextTiles5x5.length !== CONTEXT_SPAN) return [];
    return contextTiles5x5.slice(1, 4).map((row) => row.slice(1, 4));
  }, [contextTiles5x5]);

  const blendedPreview5x5 = useMemo(
    () => compose5x5WithCenter(contextTiles5x5, blendedCenter3x3),
    [contextTiles5x5, blendedCenter3x3],
  );

  const disabled = busy || loading || !item;
  const showOpen = open && item != null;

  return (
    <Dialog.Root open={showOpen} onOpenChange={(nextOpen) => { if (!nextOpen) onCancelBatch(); }}>
      <Dialog.Portal>
        <Dialog.Overlay data-dialog-root className="fixed inset-0 bg-black/55 backdrop-blur-sm z-[10020]" />
        <Dialog.Content
          data-dialog-root
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[10021] w-[min(96vw,1180px)] max-h-[92vh] overflow-auto rounded-2xl border border-gray-200 bg-white p-4 shadow-2xl"
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-base font-semibold text-gray-900">Batch Human Review</Dialog.Title>
              <Dialog.Description className="text-xs text-gray-600 mt-1">
                Anchor ({item?.x}, {item?.y}) at z={item?.z} | model {item ? MODEL_VARIANT_LABELS[item.modelVariant] : "-"}
              </Dialog.Description>
            </div>
            <div className="rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-600">
              queued {pendingCount}
            </div>
          </div>

          {error && (
            <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">
              {error}
            </div>
          )}

          <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1.35fr]">
            <TileGrid
              title="Original 3x3"
              subtitle="Center crop from current map context"
              tiles={originalCenter3x3}
              sizeClass="aspect-square w-full"
            />
            <TileGrid
              title="Generated 3x3 (Raw)"
              subtitle="Model output before blend"
              tiles={rawCenter3x3 ?? []}
              sizeClass="aspect-square w-full"
            />
            <TileGrid
              title="Blended 5x5"
              subtitle="Center 3x3 blended into original 5x5 context"
              tiles={blendedPreview5x5}
              sizeClass="aspect-square w-full"
            />
          </div>

          {loading && (
            <div className="mt-3 text-xs text-gray-500">
              Loading review images...
            </div>
          )}

          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              className="h-8 rounded-md border border-red-200 bg-red-50 px-3 text-xs text-red-700 hover:bg-red-100 disabled:opacity-60"
              disabled={busy}
              onClick={onCancelBatch}
            >
              Cancel Batch
            </button>
            <button
              type="button"
              className="h-8 rounded-md border border-gray-300 px-3 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              disabled={disabled}
              onClick={() => {
                void onReject();
              }}
            >
              Reject (Regenerate Pro)
            </button>
            <button
              type="button"
              className="h-8 rounded-md bg-emerald-600 px-3 text-xs text-white hover:bg-emerald-700 disabled:opacity-60"
              disabled={disabled}
              onClick={() => {
                void onAccept();
              }}
            >
              Accept
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
