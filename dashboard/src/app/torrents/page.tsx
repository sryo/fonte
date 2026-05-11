"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  getTorrents,
  addTorrent,
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

function statusColor(status: TorrentStatus): string {
  switch (status) {
    case "downloading":
      return "text-blue-600 dark:text-blue-400";
    case "seeding":
      return "text-green-600 dark:text-green-400";
    case "completed":
      return "text-green-600 dark:text-green-400";
    case "paused":
      return "text-yellow-600 dark:text-yellow-400";
    case "error":
      return "text-red-600 dark:text-red-400";
    case "adding":
      return "text-muted-foreground";
    default:
      return "text-muted-foreground";
  }
}

function progressBarColor(status: TorrentStatus): string {
  switch (status) {
    case "downloading":
      return "bg-blue-500";
    case "seeding":
      return "bg-green-500";
    case "completed":
      return "bg-green-500";
    case "paused":
      return "bg-yellow-500";
    case "error":
      return "bg-red-500";
    default:
      return "bg-muted-foreground";
  }
}

// ── Main Page ────────────────────────────────────────────────────────────

export default function TorrentsPage() {
  const [torrents, setTorrents] = useState<TorrentRecord[]>([]);
  const [stats, setStats] = useState<TorrentStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabFilter>("all");
  const [showAddDialog, setShowAddDialog] = useState(false);
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

  const handleAdd = useCallback(
    async (magnetUri: string) => {
      try {
        await addTorrent({ magnetUri });
        setShowAddDialog(false);
        setActionError(null);
        fetchData();
      } catch (err) {
        setActionError((err as Error).message);
      }
    },
    [fetchData],
  );

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
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Torrents</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage downloads and seeding
          </p>
        </div>
        <button
          onClick={() => {
            setShowAddDialog(true);
            setActionError(null);
          }}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 4.5v15m7.5-7.5h-15"
            />
          </svg>
          Add Torrent
        </button>
      </div>

      {/* Stats Bar */}
      {stats && (
        <div className="flex items-center gap-6 px-4 py-3 border bg-card text-card-foreground text-sm">
          <div className="flex items-center gap-2">
            <svg
              className="h-4 w-4 text-blue-500"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19.5 13.5 12 21m0 0-7.5-7.5M12 21V3"
              />
            </svg>
            <span className="text-muted-foreground">Down:</span>
            <span className="font-medium">
              {formatSpeed(stats.downloadSpeed)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <svg
              className="h-4 w-4 text-green-500"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4.5 10.5 12 3m0 0 7.5 7.5M12 3v18"
              />
            </svg>
            <span className="text-muted-foreground">Up:</span>
            <span className="font-medium">
              {formatSpeed(stats.uploadSpeed)}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-4 text-muted-foreground">
            <span>
              {stats.activeTorrents} active
            </span>
            <span>
              {stats.totalTorrents} total
            </span>
          </div>
        </div>
      )}

      {/* Tab Filters */}
      <div className="flex items-center gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t.key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
            {t.key !== "all" && (
              <span className="ml-1.5 text-xs text-muted-foreground">
                {torrents.filter((torrent) =>
                  t.key === "all" ? true : torrent.status === t.key,
                ).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Action Error */}
      {actionError && (
        <div className="flex items-center justify-between px-4 py-2 text-sm border border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
          <span>{actionError}</span>
          <button
            onClick={() => setActionError(null)}
            className="text-red-500 hover:text-red-700 dark:hover:text-red-300"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center">
          <div className="h-4 w-4 animate-spin border-2 border-primary border-t-transparent rounded-full" />
          Loading torrents...
        </div>
      ) : error ? (
        <div className="py-12 text-center">
          <p className="text-sm text-destructive">{error}</p>
          <button
            onClick={fetchData}
            className="mt-3 text-sm text-primary underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center">
          <svg
            className="h-10 w-10 text-muted-foreground mx-auto mb-4"
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
          <p className="text-lg font-medium">
            {tab === "all"
              ? "No torrents yet"
              : `No ${tab} torrents`}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {tab === "all"
              ? 'Click "Add Torrent" to get started'
              : "Try a different filter"}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((torrent) => (
            <TorrentRow
              key={torrent.id}
              torrent={torrent}
              onPause={handlePause}
              onResume={handleResume}
              onRemove={handleRemove}
            />
          ))}
        </div>
      )}

      {/* Add Torrent Dialog */}
      {showAddDialog && (
        <AddTorrentDialog
          onAdd={handleAdd}
          onClose={() => {
            setShowAddDialog(false);
            setActionError(null);
          }}
          error={actionError}
        />
      )}
    </div>
  );
}

// ── Torrent Row ──────────────────────────────────────────────────────────

function TorrentRow({
  torrent,
  onPause,
  onResume,
  onRemove,
}: {
  torrent: TorrentRecord;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const pct = Math.round(torrent.progress * 100);

  return (
    <div className="border bg-card text-card-foreground p-4 space-y-3">
      {/* Top: name + status + actions */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate" title={torrent.name}>
            {torrent.name || torrent.infoHash}
          </p>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            <span className={statusColor(torrent.status)}>
              {statusLabel(torrent.status)}
            </span>
            <span>
              {formatBytes(torrent.downloaded)} / {formatBytes(torrent.size)}
            </span>
            {torrent.numPeers > 0 && (
              <span>{torrent.numPeers} peers</span>
            )}
            {torrent.errorMessage && (
              <span className="text-destructive" title={torrent.errorMessage}>
                {torrent.errorMessage}
              </span>
            )}
          </div>
        </div>

        {/* Speeds */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground shrink-0">
          {torrent.downloadSpeed > 0 && (
            <span className="text-blue-600 dark:text-blue-400">
              {formatSpeed(torrent.downloadSpeed)}
            </span>
          )}
          {torrent.uploadSpeed > 0 && (
            <span className="text-green-600 dark:text-green-400">
              {formatSpeed(torrent.uploadSpeed)}
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {torrent.status === "downloading" || torrent.status === "seeding" ? (
            <button
              onClick={() => onPause(torrent.id)}
              title="Pause"
              className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5" />
              </svg>
            </button>
          ) : torrent.status === "paused" ? (
            <button
              onClick={() => onResume(torrent.id)}
              title="Resume"
              className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
              </svg>
            </button>
          ) : null}

          {confirmRemove ? (
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  onRemove(torrent.id);
                  setConfirmRemove(false);
                }}
                className="px-2 py-1 text-xs bg-destructive text-destructive-foreground hover:opacity-90"
              >
                Remove
              </button>
              <button
                onClick={() => setConfirmRemove(false)}
                className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmRemove(true)}
              title="Remove"
              className="p-1.5 text-muted-foreground hover:text-destructive transition-colors"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-2 bg-muted overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${progressBarColor(torrent.status)}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-xs font-mono text-muted-foreground w-10 text-right">
          {pct}%
        </span>
      </div>
    </div>
  );
}

// ── Add Torrent Dialog ───────────────────────────────────────────────────

function AddTorrentDialog({
  onAdd,
  onClose,
  error,
}: {
  onAdd: (magnetUri: string) => void;
  onClose: () => void;
  error: string | null;
}) {
  const [magnetUri, setMagnetUri] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async () => {
    const trimmed = magnetUri.trim();
    if (!trimmed) return;
    setSubmitting(true);
    await onAdd(trimmed);
    setSubmitting(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !submitting) {
      handleSubmit();
    }
    if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-lg border bg-card text-card-foreground p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Add Torrent</h2>
          <button
            onClick={onClose}
            className="p-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Magnet URI
          </label>
          <input
            ref={inputRef}
            type="text"
            value={magnetUri}
            onChange={(e) => setMagnetUri(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="magnet:?xt=urn:btih:..."
            className="w-full px-3 py-2 text-sm border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring font-mono"
            disabled={submitting}
          />
        </div>

        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        <div className="flex items-center gap-2 pt-2">
          <button
            onClick={handleSubmit}
            disabled={submitting || !magnetUri.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting && (
              <div className="h-3 w-3 animate-spin border-2 border-primary-foreground border-t-transparent rounded-full" />
            )}
            Add Torrent
          </button>
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
