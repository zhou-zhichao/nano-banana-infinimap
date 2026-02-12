"use client";

import { useMemo, useState } from "react";
import type { TilemapManifest, TilemapTemplate } from "@/lib/tilemaps/types";

type Props = {
  tilemaps: TilemapManifest[];
  activeMapId: string;
  onSelect: (mapId: string) => void;
  onCreated: (map: TilemapManifest) => void;
};

const DEFAULT_BLANK_WIDTH = 64;
const DEFAULT_BLANK_HEIGHT = 64;

export default function TilemapSidebar({ tilemaps, activeMapId, onSelect, onCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [template, setTemplate] = useState<TilemapTemplate>("blank");
  const [width, setWidth] = useState(DEFAULT_BLANK_WIDTH);
  const [height, setHeight] = useState(DEFAULT_BLANK_HEIGHT);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const items = useMemo(() => tilemaps, [tilemaps]);

  const resetForm = () => {
    setName("");
    setTemplate("blank");
    setWidth(DEFAULT_BLANK_WIDTH);
    setHeight(DEFAULT_BLANK_HEIGHT);
    setSubmitting(false);
    setError(null);
  };

  const createTilemap = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const payload =
        template === "moon"
          ? { name: name.trim(), template }
          : { name: name.trim(), template, width: Math.round(width), height: Math.round(height) };
      const response = await fetch("/api/tilemaps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "Failed to create tilemap");
      }
      onCreated(data.item as TilemapManifest);
      setOpen(false);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create tilemap");
      setSubmitting(false);
    }
  };

  return (
    <aside className="w-72 border-r border-gray-200 bg-gray-50/90 h-full flex flex-col">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-gray-900">Tilemaps</div>
          <div className="text-xs text-gray-500">{items.length} total</div>
        </div>
        <button
          className="h-8 px-3 rounded-md bg-blue-600 text-white text-xs font-medium hover:bg-blue-700"
          onClick={() => {
            setOpen(true);
            resetForm();
          }}
        >
          New
        </button>
      </div>

      <div className="flex-1 overflow-auto p-2">
        {items.map((item) => {
          const active = item.id === activeMapId;
          return (
            <button
              key={item.id}
              className={`w-full text-left rounded-md px-3 py-2 mb-1 border transition-colors ${
                active ? "bg-blue-600 text-white border-blue-700" : "bg-white text-gray-800 border-gray-200 hover:bg-gray-100"
              }`}
              onClick={() => onSelect(item.id)}
            >
              <div className="text-sm font-medium truncate">{item.name}</div>
              <div className={`text-[11px] ${active ? "text-blue-100" : "text-gray-500"}`}>
                {item.id} · {item.template} · {item.width}x{item.height}
              </div>
            </button>
          );
        })}
      </div>

      {open && (
        <div className="fixed inset-0 bg-black/30 z-[10020] flex items-center justify-center p-4">
          <div className="w-[420px] rounded-xl bg-white shadow-xl border border-gray-200 p-4">
            <div className="text-base font-semibold text-gray-900 mb-3">Create Tilemap</div>
            <div className="space-y-3">
              <label className="block">
                <div className="text-xs text-gray-600 mb-1">Name</div>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="w-full h-9 px-2 rounded border border-gray-300 text-sm"
                  placeholder="e.g. crater-west"
                />
              </label>

              <div>
                <div className="text-xs text-gray-600 mb-1">Template</div>
                <div className="inline-flex rounded-md border border-gray-300 overflow-hidden">
                  <button
                    className={`px-3 h-8 text-xs ${template === "blank" ? "bg-blue-600 text-white" : "bg-white text-gray-700"}`}
                    onClick={() => setTemplate("blank")}
                  >
                    blank
                  </button>
                  <button
                    className={`px-3 h-8 text-xs border-l border-gray-300 ${
                      template === "moon" ? "bg-blue-600 text-white" : "bg-white text-gray-700"
                    }`}
                    onClick={() => setTemplate("moon")}
                  >
                    moon
                  </button>
                </div>
              </div>

              {template === "blank" ? (
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <div className="text-xs text-gray-600 mb-1">Width</div>
                    <input
                      type="number"
                      min={1}
                      max={256}
                      value={width}
                      onChange={(event) => setWidth(Number(event.target.value))}
                      className="w-full h-9 px-2 rounded border border-gray-300 text-sm"
                    />
                  </label>
                  <label className="block">
                    <div className="text-xs text-gray-600 mb-1">Height</div>
                    <input
                      type="number"
                      min={1}
                      max={256}
                      value={height}
                      onChange={(event) => setHeight(Number(event.target.value))}
                      className="w-full h-9 px-2 rounded border border-gray-300 text-sm"
                    />
                  </label>
                </div>
              ) : (
                <div className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-md p-2">
                  moon is fixed at index range 0..60 x 0..40 (actual 61x41 tiles).
                </div>
              )}

              {error && <div className="text-xs text-red-600">{error}</div>}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                className="h-8 px-3 text-xs rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
                onClick={() => {
                  setOpen(false);
                  resetForm();
                }}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                className="h-8 px-3 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
                onClick={createTilemap}
                disabled={submitting || !name.trim()}
              >
                {submitting ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
