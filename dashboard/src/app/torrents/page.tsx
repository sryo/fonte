"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  getTorrents,
  pauseTorrent,
  resumeTorrent,
  removeTorrent,
  getTorrentStats,
  type TorrentRecord,
  type TorrentStatus,
  type TorrentStats,
} from "@/lib/api";

// ── Helpers ──────────────────────────────────────────────────────────────

type TabFilter = "all" | "downloading" | "seeding" | "completed" | "paused";

const TABS: { key: TabFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "downloading", label: "Downloading" },
  { key: "seeding", label: "Seeding" },
  { key: "completed", label: "Completed" },
  { key: "paused", label: "Paused" },
];

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatSpeed(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

function statusLabel(status: TorrentStatus): string {
  switch (status) {
    case "adding":
      return "Adding";
    case "downloading":
      return "Downloading";
    case "seeding":
      return "Seeding";
    case "paused":
      return "Paused";
    case "completed":
      return "Completed";
    case "error":
      return "Error";
    case "removed":
      return "Removed";
    default:
      return status;
  }
}

function statusBadgeClass(status: TorrentStatus): string {
  switch (status) {
    case "downloading":
      return "bg-torrent/15 text-torrent";
    case "seeding":
      return "bg-subtitle/15 text-subtitle";
    case "completed":
      return "bg-subtitle/15 text-subtitle";
    case "paused":
      return "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400";
    case "error":
      return "bg-destructive/15 text-destructive";
    case "adding":
      return "bg-muted text-muted-foreground";
    default:
      return "bg-muted text-muted-foreground";
  }
}

// ── Progress Ring ────────────────────────────────────────────────────────

function ProgressRing({ progress, size = 56 }: { progress: number; size?: number }) {
  const r = (size - 6) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - progress * circumference;
  return (
    <svg width={size} height={size} className="shrink-0">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="currentColor" strokeWidth={3} className="text-muted" />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="currentColor" strokeWidth={3}
        className="text-torrent" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset}
        transform={`rotate(-90 ${size/2} ${size/2})`} style={{transition: "stroke-dashoffset 0.3s"}} />
      <text x="50%" y="50%" textAnchor="middle" dy="0.35em" className="fill-foreground text-xs font-bold">
        {Math.round(progress * 100)}%
      </text>
    </svg>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────

export default function TorrentsPage() {
  const router = useRouter();
  const [torrents, setTorrents] = useState<TorrentRecord[]>([]);
  const [stats, setStats] = useState<TorrentStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabFilter>("all");
  const [actionError, setActionError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    try {
      const [torrentsRes, statsRes] = await Promise.all([
        getTorrents(),
        getTorrentStats(),
      ]);
      if (mountedRef.current) {
        setTorrents(torrentsRes.torrents);
        setStats({
          downloadSpeed: statsRes.downloadSpeed,
          uploadSpeed: statsRes.uploadSpeed,
          activeTorrents: statsRes.activeTorrents,
          totalTorrents: statsRes.totalTorrents,
        });
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError((err as Error).message);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchData();
    const id = setInterval(fetchData, 2000);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [fetchData]);

  const handlePause = useCallback(
    async (id: string) => {
      try {
        await pauseTorrent(id);
        setActionError(null);
        fetchData();
      } catch (err) {
        setActionError((err as Error).message);
      }
    },
    [fetchData],
  );

  const handleResume = useCallback(
    async (id: string) => {
      try {
        await resumeTorrent(id);
        setActionError(null);
        fetchData();
      } catch (err) {
        setActionError((err as Error).message);
      }
    },
    [fetchData],
  );

  const handleRemove = useCallback(
    async (id: string) => {
      try {
        await removeTorrent(id);
        setActionError(null);
        fetchData();
      } catch (err) {
        setActionError((err as Error).message);
      }
    },
    [fetchData],
  );

  const filtered =
    tab === "all"
      ? torrents
      : torrents.filter((t) => t.status === tab);

  return (
    <div className="p-6 md:p-8 space-y-6">
      {/* Stats row */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="flex items-center gap-3 rounded-xl bg-torrent/10 p-3">
            <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-torrent/15">
              <svg className="h-4 w-4 text-torrent" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 13.5 12 21m0 0-7.5-7.5M12 21V3" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold">{formatSpeed(stats.downloadSpeed)}</p>
              <p className="text-xs text-muted-foreground">Download</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-xl bg-torrent/10 p-3">
            <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-torrent/15">
              <svg className="h-4 w-4 text-torrent" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5 12 3m0 0 7.5 7.5M12 3v18" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold">{formatSpeed(stats.uploadSpeed)}</p>
              <p className="text-xs text-muted-foreground">Upload</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-xl bg-torrent/10 p-3">
            <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-torrent/15">
              <svg className="h-4 w-4 text-torrent" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold">{stats.activeTorrents}</p>
              <p className="text-xs text-muted-foreground">Active</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-xl bg-torrent/10 p-3">
            <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-torrent/15">
              <svg className="h-4 w-4 text-torrent" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold">{stats.totalTorrents}</p>
              <p className="text-xs text-muted-foreground">Total</p>
            </div>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {TABS.map((t) => {
          const count = t.key === "all"
            ? torrents.length
            : torrents.filter((torrent) => torrent.status === t.key).length;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                tab === t.key
                  ? "bg-torrent text-torrent-foreground shadow-sm"
                  : "bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80"
              }`}
            >
              {t.label}
              {t.key !== "all" && count > 0 && (
                <span className={`ml-1.5 text-xs ${tab === t.key ? "text-torrent-foreground/70" : "text-muted-foreground"}`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Action Error */}
      {actionError && (
        <div className="flex items-center justify-between px-4 py-3 text-sm rounded-xl border border-destructive/30 bg-destructive/5 text-destructive">
          <span>{actionError}</span>
          <button
            onClick={() => setActionError(null)}
            className="text-destructive/60 hover:text-destructive transition-colors ml-3 shrink-0"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-16 justify-center">
          <div className="h-5 w-5 animate-spin border-2 border-torrent border-t-transparent rounded-full" />
          Loading torrents...
        </div>
      ) : error ? (
        <div className="py-16 text-center">
          <p className="text-sm text-destructive">{error}</p>
          <button
            onClick={fetchData}
            className="mt-3 text-sm text-torrent hover:underline"
          >
            Retry
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center">
          <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-torrent/10 mb-4">
            <svg
              className="h-8 w-8 text-torrent"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"
              />
            </svg>
          </div>
          <p className="text-lg font-medium">
            {tab === "all"
              ? "No torrents yet"
              : `No ${tab} torrents`}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {tab === "all"
              ? "Use the search bar above to add a torrent"
              : "Try a different filter"}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((torrent) => (
            <TorrentCard
              key={torrent.id}
              torrent={torrent}
              onPause={handlePause}
              onResume={handleResume}
              onRemove={handleRemove}
              onClick={() => router.push(`/torrents/${torrent.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Torrent Card ────────────────────────────────────────────────────────

function TorrentCard({
  torrent,
  onPause,
  onResume,
  onRemove,
  onClick,
}: {
  torrent: TorrentRecord;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onRemove: (id: string) => void;
  onClick: () => void;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);

  return (
    <div
      className="rounded-xl shadow-sm border bg-card text-card-foreground p-4 hover:shadow-md transition-shadow cursor-pointer group"
      onClick={onClick}
    >
      <div className="flex gap-4">
        {/* Progress ring */}
        <ProgressRing progress={torrent.progress} size={56} />

        {/* Content */}
        <div className="min-w-0 flex-1">
          {/* Name */}
          <p
            className="text-sm font-semibold leading-snug line-clamp-2 group-hover:text-torrent transition-colors"
            title={torrent.name || torrent.infoHash}
          >
            {torrent.name || torrent.infoHash}
          </p>

          {/* Status badge */}
          <div className="flex items-center gap-2 mt-1.5">
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(torrent.status)}`}>
              {statusLabel(torrent.status)}
            </span>
            {torrent.errorMessage && (
              <span className="text-xs text-destructive truncate" title={torrent.errorMessage}>
                {torrent.errorMessage}
              </span>
            )}
          </div>

          {/* Speed + peers info */}
          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
            {torrent.downloadSpeed > 0 && (
              <span className="text-torrent font-medium">
                <span className="opacity-70 mr-0.5">&#8595;</span> {formatSpeed(torrent.downloadSpeed)}
              </span>
            )}
            {torrent.uploadSpeed > 0 && (
              <span className="text-subtitle font-medium">
                <span className="opacity-70 mr-0.5">&#8593;</span> {formatSpeed(torrent.uploadSpeed)}
              </span>
            )}
            {torrent.numPeers > 0 && (
              <span>{torrent.numPeers} peers</span>
            )}
            {torrent.downloadSpeed === 0 && torrent.uploadSpeed === 0 && torrent.numPeers === 0 && (
              <span>{formatBytes(torrent.downloaded)} / {formatBytes(torrent.size)}</span>
            )}
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center justify-end gap-1 mt-3 pt-3 border-t border-border/50" onClick={(e) => e.stopPropagation()}>
        {(torrent.status === "downloading" || torrent.status === "seeding") && (
          <button
            onClick={() => onPause(torrent.id)}
            title="Pause"
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5" />
            </svg>
          </button>
        )}
        {torrent.status === "paused" && (
          <button
            onClick={() => onResume(torrent.id)}
            title="Resume"
            className="p-1.5 rounded-lg text-muted-foreground hover:text-torrent hover:bg-torrent/10 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
            </svg>
          </button>
        )}

        {confirmRemove ? (
          <div className="flex items-center gap-1 ml-1">
            <button
              onClick={() => {
                onRemove(torrent.id);
                setConfirmRemove(false);
              }}
              className="px-2.5 py-1 text-xs rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 font-medium"
            >
              Remove
            </button>
            <button
              onClick={() => setConfirmRemove(false)}
              className="px-2 py-1 text-xs rounded-lg text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmRemove(true)}
            title="Remove"
            className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
