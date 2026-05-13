"use client";

import { useState, useEffect, useCallback } from "react";
import { getTorrentStats, getTorrents } from "@/lib/api";
import { formatSpeed, formatBytes } from "@/lib/format";

export function StatusStrip() {
  const [downloadSpeed, setDownloadSpeed] = useState(0);
  const [uploadSpeed, setUploadSpeed] = useState(0);
  const [activeTorrents, setActiveTorrents] = useState(0);
  const [remainingBytes, setRemainingBytes] = useState(0);
  const [aggregateProgress, setAggregateProgress] = useState(0);

  const fetchData = useCallback(async () => {
    try {
      const [stats, torrentsRes] = await Promise.all([
        getTorrentStats(),
        getTorrents(),
      ]);

      setDownloadSpeed(stats.downloadSpeed);
      setUploadSpeed(stats.uploadSpeed);
      setActiveTorrents(stats.activeTorrents);

      // Calculate remaining bytes and aggregate progress from active torrents
      const active = torrentsRes.torrents.filter(
        (t) => t.status === "downloading" || t.status === "seeding"
      );

      if (active.length > 0) {
        const totalSize = active.reduce((sum, t) => sum + t.size, 0);
        const totalDownloaded = active.reduce((sum, t) => sum + t.downloaded, 0);
        const remaining = Math.max(0, totalSize - totalDownloaded);
        setRemainingBytes(remaining);
        setAggregateProgress(totalSize > 0 ? (totalDownloaded / totalSize) * 100 : 0);
      } else {
        setRemainingBytes(0);
        setAggregateProgress(0);
      }
    } catch {
      /* silently ignore when API is unreachable */
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 2000);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (activeTorrents === 0) return null;

  return (
    <div className="border-t bg-card/80 backdrop-blur-sm">
      {/* Progress bar */}
      <div className="h-0.5 bg-muted">
        <div
          className="h-full bg-torrent transition-all duration-500"
          style={{ width: `${Math.min(100, aggregateProgress)}%` }}
        />
      </div>

      {/* Stats text */}
      <div className="text-xs text-muted-foreground text-center py-2 flex items-center justify-center gap-1">
        <span>
          <span aria-label="Download speed" className="text-torrent">&#8595;</span>{" "}
          {formatSpeed(downloadSpeed)}
        </span>
        <span className="mx-1 opacity-40">&bull;</span>
        <span>
          <span aria-label="Upload speed" className="text-green-500">&#8593;</span>{" "}
          {formatSpeed(uploadSpeed)}
        </span>
        <span className="mx-1 opacity-40">&bull;</span>
        <span>{activeTorrents} active</span>
        <span className="mx-1 opacity-40">&bull;</span>
        <span>{formatBytes(remainingBytes)} remaining</span>
      </div>
    </div>
  );
}
