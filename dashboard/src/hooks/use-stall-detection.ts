"use client";

import { useCallback, useRef } from "react";
import type { TorrentRecord } from "@/lib/api";

const STALL_MS = 30_000;

// Flags a download as stalled when its progress hasn't advanced for STALL_MS.
// Feed each poll result through recordProgress so the history stays current.
export function useStallDetection() {
  // Per-torrent progress history: id → { progress: 0-1, ts: ms since epoch when last changed }
  const progressHistoryRef = useRef<Map<string, { progress: number; ts: number }>>(new Map());

  const recordProgress = useCallback((torrents: TorrentRecord[]) => {
    const now = Date.now();
    const history = progressHistoryRef.current;
    const seen = new Set<string>();
    for (const t of torrents) {
      seen.add(t.id);
      const prev = history.get(t.id);
      if (!prev || t.progress > prev.progress) {
        history.set(t.id, { progress: t.progress, ts: now });
      }
    }
    for (const id of history.keys()) {
      if (!seen.has(id)) history.delete(id);
    }
  }, []);

  const isStalled = useCallback((torrent: TorrentRecord): boolean => {
    if (torrent.status !== "downloading") return false;
    if (torrent.progress >= 1) return false;
    const entry = progressHistoryRef.current.get(torrent.id);
    if (!entry) return false;
    return Date.now() - entry.ts > STALL_MS;
  }, []);

  return { recordProgress, isStalled };
}
