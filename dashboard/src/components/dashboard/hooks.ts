"use client";

import * as React from "react";
import type {
  PipelineStatus,
  VariantsResponse,
  PlayerPreferencesResponse,
  DepsMap,
  DepsListResponse,
  PreferenceUpdateBody,
  PlayerListResponse,
  RecentDepMapsResponse,
} from "./types";

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

/**
 * Generic polling hook. Pass `url=null` to disable polling (the hook
 * stays mounted but does nothing — useful when a tab is unmounted).
 */
export function usePoll<T>(
  url: string | null,
  intervalMs: number
): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [reloadKey, setReloadKey] = React.useState(0);

  const reload = React.useCallback(() => setReloadKey((k) => k + 1), []);

  React.useEffect(() => {
    if (!url) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const load = () => {
      fetchJson<T>(url)
        .then((d) => {
          if (!cancelled) {
            setData(d);
            setError(null);
            setLoading(false);
          }
        })
        .catch((e: Error) => {
          if (!cancelled) {
            setError(e.message);
            setLoading(false);
          }
        });
    };
    load();
    const t = setInterval(load, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [url, intervalMs, reloadKey]);

  return { data, error, loading, reload };
}

export function usePipelineStatus() {
  return usePoll<PipelineStatus>("/api/pipeline-status", 10000);
}

export function useVariants() {
  return usePoll<VariantsResponse>("/api/variants", 30000);
}

export function usePlayerPreferences(playerId = 1, intervalMs = 5000) {
  const { data, error, loading, reload } = usePoll<PlayerPreferencesResponse>(
    `/api/player-preferences?playerId=${playerId}`,
    intervalMs
  );

  const update = React.useCallback(
    async (body: PreferenceUpdateBody) => {
      const r = await fetch(`/api/player-preferences?playerId=${playerId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const updated = (await r.json()) as PlayerPreferencesResponse;
      // Immediate local refresh so the UI reflects the change before the
      // next polling tick.
      reload();
      return updated;
    },
    [playerId, reload]
  );

  return { data, error, loading, update, reload };
}

export function usePlayerList() {
  return usePoll<PlayerListResponse>("/api/player-preferences?action=list", 10000);
}

export function useRecentDepMaps() {
  return usePoll<RecentDepMapsResponse>("/api/player-preferences?action=recent-dep-maps", 15000);
}

export function useDepsList() {
  return usePoll<DepsListResponse>("/api/deps", 60000);
}

export function useDepsMap(name: string | null) {
  const url = name ? `/api/deps?name=${encodeURIComponent(name)}` : null;
  return usePoll<DepsMap>(url, 60000);
}
