"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import {
  getWatchlist,
  addWatchlistEntry,
  updateWatchlistEntry,
  deleteWatchlistEntry,
  triggerWatchlistSearch,
  triggerWatchlistCheck,
  type WatchlistRecord,
  type WatchlistStatus,
  type MediaType,
} from "@/lib/api";

// ── Helpers ──────────────────────────────────────────────────────────────

type TabFilter = "all" | "watching" | "fulfilled" | "paused";

const TABS: { key: TabFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "watching", label: "Watching" },
  { key: "fulfilled", label: "Fulfilled" },
  { key: "paused", label: "Paused" },
];

function statusBadge(status: WatchlistStatus): { label: string; className: string } {
  switch (status) {
    case "watching":
      return { label: "Watching", className: "bg-watchlist/15 text-watchlist" };
    case "fulfilled":
      return { label: "Fulfilled", className: "bg-subtitle/15 text-subtitle" };
    case "paused":
      return { label: "Paused", className: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400" };
    default:
      return { label: status, className: "bg-muted text-muted-foreground" };
  }
}

function formatTime(ts?: number): string {
  if (!ts) return "Never";
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString();
}

// ── Main Page ────────────────────────────────────────────────────────────

export default function WatchlistPage() {
  const [entries, setEntries] = useState<WatchlistRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabFilter>("all");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await getWatchlist();
      if (mountedRef.current) {
        setEntries(res.entries);
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
    const id = setInterval(fetchData, 10000);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [fetchData]);

  const handleAdd = useCallback(
    async (data: { title: string; mediaType: MediaType; year?: number; quality?: string; seasonPattern?: string }) => {
      try {
        await addWatchlistEntry(data);
        setShowAddDialog(false);
        setActionError(null);
        fetchData();
      } catch (err) {
        setActionError((err as Error).message);
      }
    },
    [fetchData],
  );

  const handleSearch = useCallback(
    async (id: string) => {
      try {
        await triggerWatchlistSearch(id);
        setActionError(null);
        fetchData();
      } catch (err) {
        setActionError((err as Error).message);
      }
    },
    [fetchData],
  );

  const handleTogglePause = useCallback(
    async (entry: WatchlistRecord) => {
      try {
        const newStatus: WatchlistStatus = entry.status === "paused" ? "watching" : "paused";
        await updateWatchlistEntry(entry.id, { status: newStatus });
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
        await deleteWatchlistEntry(id);
        setActionError(null);
        fetchData();
      } catch (err) {
        setActionError((err as Error).message);
      }
    },
    [fetchData],
  );

  const handleCheckAll = useCallback(async () => {
    try {
      await triggerWatchlistCheck();
      setActionError(null);
      fetchData();
    } catch (err) {
      setActionError((err as Error).message);
    }
  }, [fetchData]);

  const filtered = tab === "all" ? entries : entries.filter((e) => e.status === tab);

  const counts = {
    all: entries.length,
    watching: entries.filter((e) => e.status === "watching").length,
    fulfilled: entries.filter((e) => e.status === "fulfilled").length,
    paused: entries.filter((e) => e.status === "paused").length,
  };

  return (
    <div className="p-6 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            <span className="text-watchlist">Watchlist</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track and auto-download movies and TV shows
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCheckAll}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border text-foreground hover:bg-muted transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
            </svg>
            Check All
          </button>
          <button
            onClick={() => {
              setShowAddDialog(true);
              setActionError(null);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-watchlist text-watchlist-foreground hover:bg-watchlist/90 rounded-lg transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add to Watchlist
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === t.key
                ? "bg-watchlist text-watchlist-foreground shadow-sm"
                : "bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80"
            }`}
          >
            {t.label}
            <span className={`ml-1.5 text-xs ${tab === t.key ? "text-watchlist-foreground/70" : "text-muted-foreground"}`}>
              {counts[t.key]}
            </span>
          </button>
        ))}
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
          <div className="h-5 w-5 animate-spin border-2 border-watchlist border-t-transparent rounded-full" />
          Loading watchlist...
        </div>
      ) : error ? (
        <div className="py-16 text-center">
          <p className="text-sm text-destructive">{error}</p>
          <button
            onClick={fetchData}
            className="mt-3 text-sm text-watchlist hover:underline"
          >
            Retry
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center">
          <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-watchlist/10 mb-4">
            <svg
              className="h-8 w-8 text-watchlist"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
            </svg>
          </div>
          <p className="text-lg font-medium">
            {tab === "all" ? "No watchlist entries yet" : `No ${tab} entries`}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {tab === "all"
              ? "Click \"Add to Watchlist\" to start tracking media"
              : "Try a different filter"}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filtered.map((entry) => (
            <WatchlistCard
              key={entry.id}
              entry={entry}
              onSearch={handleSearch}
              onTogglePause={handleTogglePause}
              onRemove={handleRemove}
            />
          ))}
        </div>
      )}

      {/* Add Dialog */}
      {showAddDialog && (
        <AddWatchlistDialog
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

// ── Watchlist Card ──────────────────────────────────────────────────────

function WatchlistCard({
  entry,
  onSearch,
  onTogglePause,
  onRemove,
}: {
  entry: WatchlistRecord;
  onSearch: (id: string) => void;
  onTogglePause: (entry: WatchlistRecord) => void;
  onRemove: (id: string) => void;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const badge = statusBadge(entry.status);

  return (
    <div className="rounded-xl shadow-sm overflow-hidden border bg-card text-card-foreground group relative">
      {/* Colored header area */}
      <div className="h-24 bg-watchlist/10 flex items-center justify-center relative">
        {entry.mediaType === "tv" ? (
          <svg className="h-10 w-10 text-watchlist/40" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 20.25h12m-7.5-3v3m3-3v3m-10.125-3h17.25c.621 0 1.125-.504 1.125-1.125V4.125c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v12c0 .621.504 1.125 1.125 1.125Z" />
          </svg>
        ) : (
          <svg className="h-10 w-10 text-watchlist/40" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m3.375 19.5h17.25m-17.25 0a1.125 1.125 0 0 1-1.125-1.125M3.375 19.5h1.5C5.496 19.5 6 18.996 6 18.375m-3.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-1.5A1.125 1.125 0 0 1 18 18.375M20.625 4.5H3.375m17.25 0c.621 0 1.125.504 1.125 1.125M20.625 4.5h-1.5C18.504 4.5 18 5.004 18 5.625m3.75 0v1.5c0 .621-.504 1.125-1.125 1.125M3.375 4.5c-.621 0-1.125.504-1.125 1.125M3.375 4.5h1.5C5.496 4.5 6 5.004 6 5.625m-3.75 0v1.5c0 .621.504 1.125 1.125 1.125m0 0h1.5m-1.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m1.5-3.75C5.496 8.25 6 7.746 6 7.125v-1.5M4.875 8.25C5.496 8.25 6 8.754 6 9.375v1.5c0 .621-.504 1.125-1.125 1.125m1.5 0h12m-12 0v-1.5c0-.621-.504-1.125-1.125-1.125M18 12.75h1.5m-1.5 0c-.621 0-1.125-.504-1.125-1.125v-1.5c0-.621.504-1.125 1.125-1.125m1.5 3.75c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m-17.25 0h1.5m14.25 0h1.5" />
          </svg>
        )}

        {/* Hover overlay with actions */}
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
          <button
            onClick={() => onSearch(entry.id)}
            title="Search now"
            className="p-2 rounded-lg bg-white/20 text-white hover:bg-white/30 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
          </button>

          {entry.status !== "fulfilled" && (
            <button
              onClick={() => onTogglePause(entry)}
              title={entry.status === "paused" ? "Resume" : "Pause"}
              className="p-2 rounded-lg bg-white/20 text-white hover:bg-white/30 transition-colors"
            >
              {entry.status === "paused" ? (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
                </svg>
              ) : (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5" />
                </svg>
              )}
            </button>
          )}

          {confirmRemove ? (
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  onRemove(entry.id);
                  setConfirmRemove(false);
                }}
                className="px-2.5 py-1.5 text-xs rounded-lg bg-destructive text-white hover:bg-destructive/90 font-medium"
              >
                Remove
              </button>
              <button
                onClick={() => setConfirmRemove(false)}
                className="px-2 py-1.5 text-xs rounded-lg text-white/70 hover:text-white"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmRemove(true)}
              title="Remove"
              className="p-2 rounded-lg bg-white/20 text-white hover:bg-red-500/50 transition-colors"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Card body */}
      <Link href={`/watchlist/${entry.id}`} className="block p-3.5">
        {/* Title */}
        <p className="text-sm font-semibold leading-snug line-clamp-2 group-hover:text-watchlist transition-colors">
          {entry.title}
        </p>

        {/* Year + quality badges */}
        <div className="flex items-center gap-1.5 mt-2">
          {entry.year && (
            <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {entry.year}
            </span>
          )}
          <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {entry.quality}
          </span>
          {entry.seasonPattern && (
            <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {entry.seasonPattern}
            </span>
          )}
        </div>

        {/* Status badge */}
        <div className="mt-2.5">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}>
            {badge.label}
          </span>
        </div>

        {/* Bottom: media type + last checked */}
        <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-border/50">
          <span className="inline-flex rounded-full bg-watchlist/10 text-watchlist px-2 py-0.5 text-xs font-medium">
            {entry.mediaType === "tv" ? "TV" : "Movie"}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatTime(entry.lastCheckedAt)}
          </span>
        </div>
      </Link>
    </div>
  );
}

// ── Add Watchlist Dialog ─────────────────────────────────────────────────

function AddWatchlistDialog({
  onAdd,
  onClose,
  error,
}: {
  onAdd: (data: { title: string; mediaType: MediaType; year?: number; quality?: string; seasonPattern?: string }) => void;
  onClose: () => void;
  error: string | null;
}) {
  const [title, setTitle] = useState("");
  const [mediaType, setMediaType] = useState<MediaType>("movie");
  const [year, setYear] = useState("");
  const [quality, setQuality] = useState("1080p");
  const [seasonPattern, setSeasonPattern] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    setSubmitting(true);
    const data: { title: string; mediaType: MediaType; year?: number; quality?: string; seasonPattern?: string } = {
      title: trimmedTitle,
      mediaType,
      quality,
    };
    if (year.trim()) {
      const parsed = parseInt(year.trim(), 10);
      if (!isNaN(parsed)) data.year = parsed;
    }
    if (mediaType === "tv" && seasonPattern.trim()) {
      data.seasonPattern = seasonPattern.trim();
    }
    await onAdd(data);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-xl border bg-card text-card-foreground p-6 space-y-4 shadow-lg animate-card-enter"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Add to Watchlist</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Title */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Title *</label>
          <input
            ref={inputRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. Breaking Bad"
            className="w-full px-3 py-2 text-sm rounded-lg border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-watchlist/40 focus:border-watchlist/50 transition-all"
            disabled={submitting}
          />
        </div>

        {/* Type + Year row */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Type</label>
            <select
              value={mediaType}
              onChange={(e) => setMediaType(e.target.value as MediaType)}
              className="w-full px-3 py-2 text-sm rounded-lg border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-watchlist/40 focus:border-watchlist/50"
              disabled={submitting}
            >
              <option value="movie">Movie</option>
              <option value="tv">TV</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Year (optional)</label>
            <input
              type="number"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g. 2024"
              className="w-full px-3 py-2 text-sm rounded-lg border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-watchlist/40 focus:border-watchlist/50"
              disabled={submitting}
            />
          </div>
        </div>

        {/* Quality */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Quality</label>
          <select
            value={quality}
            onChange={(e) => setQuality(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-lg border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-watchlist/40 focus:border-watchlist/50"
            disabled={submitting}
          >
            <option value="720p">720p</option>
            <option value="1080p">1080p</option>
            <option value="4K">4K</option>
          </select>
        </div>

        {/* Season (TV only) */}
        {mediaType === "tv" && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Season (optional)</label>
            <input
              type="text"
              value={seasonPattern}
              onChange={(e) => setSeasonPattern(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="S03"
              className="w-full px-3 py-2 text-sm rounded-lg border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-watchlist/40 focus:border-watchlist/50"
              disabled={submitting}
            />
          </div>
        )}

        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        <div className="flex items-center gap-2 pt-2">
          <button
            onClick={handleSubmit}
            disabled={submitting || !title.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-watchlist text-watchlist-foreground hover:bg-watchlist/90 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting && (
              <div className="h-3 w-3 animate-spin border-2 border-watchlist-foreground border-t-transparent rounded-full" />
            )}
            Add to Watchlist
          </button>
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm rounded-lg text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
