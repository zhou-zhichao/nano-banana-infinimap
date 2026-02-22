"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import MapClient from "./MapClient";
import TilemapSidebar from "./TilemapSidebar";
import type { TilemapManifest } from "@/lib/tilemaps/types";
import { DEFAULT_MAP_ID } from "@/lib/tilemaps/constants";

type TilemapsResponse = {
  items: TilemapManifest[];
};

export default function MapWorkspace() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [tilemaps, setTilemaps] = useState<TilemapManifest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const activeMapId = searchParams.get("mapId") || DEFAULT_MAP_ID;

  const fetchTilemaps = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/tilemaps", { cache: "no-store" });
      const data = (await response.json()) as TilemapsResponse;
      if (!response.ok) {
        throw new Error((data as any)?.error || "Failed to load tilemaps");
      }
      setTilemaps(data.items || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tilemaps");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchTilemaps();
  }, [fetchTilemaps]);

  useEffect(() => {
    if (loading || tilemaps.length === 0) return;
    if (tilemaps.some((item) => item.id === activeMapId)) return;
    const fallback = tilemaps[0];
    const params = new URLSearchParams(searchParams.toString());
    params.set("mapId", fallback.id);
    params.set("t", "1");
    router.replace(`${pathname}?${params.toString()}`);
  }, [activeMapId, loading, pathname, router, searchParams, tilemaps]);

  const activeMap = useMemo(
    () => tilemaps.find((item) => item.id === activeMapId) || tilemaps[0] || null,
    [activeMapId, tilemaps],
  );

  const selectMap = useCallback(
    (mapId: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("mapId", mapId);
      params.set("t", "1");
      router.push(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams],
  );

  const handleCreated = useCallback(
    (map: TilemapManifest) => {
      setTilemaps((prev) => [...prev, map]);
      selectMap(map.id);
    },
    [selectMap],
  );

  const handleDeleted = useCallback((mapId: string) => {
    setTilemaps((prev) => prev.filter((item) => item.id !== mapId));
  }, []);

  return (
    <main className="w-screen h-screen flex overflow-hidden">
      <TilemapSidebar
        tilemaps={tilemaps}
        activeMapId={activeMap?.id || activeMapId}
        onSelect={selectMap}
        onCreated={handleCreated}
        onDeleted={handleDeleted}
      />
      <section className="flex-1 min-w-0">
        {loading && <div className="h-full grid place-items-center text-sm text-gray-500">Loading tilemaps...</div>}
        {!loading && error && <div className="h-full grid place-items-center text-sm text-red-600">{error}</div>}
        {!loading && !error && activeMap && (
          <MapClient key={activeMap.id} mapId={activeMap.id} mapWidth={activeMap.width} mapHeight={activeMap.height} />
        )}
      </section>
    </main>
  );
}
