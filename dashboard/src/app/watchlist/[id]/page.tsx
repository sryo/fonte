"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  MagnifyingGlass,
  Pause,
  Play,
  Trash,
  Clock,
  FilmStrip,
  Television,
  Plus,
  CheckCircle,
  PencilSimple,
} from "@phosphor-icons/react";
import {
  getWatchlistEntry,
  triggerWatchlistSearch,
  addWatchlistResult,
  updateWatchlistEntry,
  deleteWatchlistEntry,
  type WatchlistRecord,
  type WatchlistResultRecord,
  type WatchlistStatus,
} from "@/lib/api";

// ── Helpers ──────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatTime(ts?: number): string {
  if (!ts) return "Never";
  const d = new Date(ts);
  return d.toLocaleString();
}

function statusBadge(status: WatchlistStatus): { label: string; className: string } {
  switch (status) {
    case "watching":
      return { label: "Watching", className: "bg-blue-500/15 text-blue-400 border-blue-500/30" };
    case "fulfilled":
      return { label: "Fulfilled", className: "bg-green-500/15 text-green-400 border-green-500/30" };
    case "paused":
      return { label: "Paused", className: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" };
    default:
      return { label: status, className: "bg-neutral-500/15 text-neutral-400 border-neutral-500/30" };
  }
}

function qualityMatchColor(score: number): string {
  if (score >= 80) return "text-green-600 dark:text-green-400";
  if (score >= 50) return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
}

// ── Main Page ────────────────────────────────────────────────────────────

export default function WatchlistDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [entry, setEntry] = useState<WatchlistRecord | null>(null);
  const [results, setResults] = useState<WatchlistResultRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [editForm, setEditForm] = useState<{
    title: string;
    mediaType: WatchlistRecord["mediaType"];
    year: string;
    quality: string;
    seasonPattern: string;
    posterUrl: string;
  }>({ title: "", mediaType: "movie", year: "", quality: "1080p", seasonPattern: "", posterUrl: "" });
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await getWatchlistEntry(id);
      if (mountedRef.current) {
        setEntry(res.entry);
        setResults(res.results);
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
  }, [id]);

  useEffect(() => {
    mountedRef.current = true;
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [fetchData]);

  const handleSearch = useCallback(async () => {
    setSearching(true);
    try {
      const res = await triggerWatchlistSearch(id);
      if (mountedRef.current) {
        setResults(res.results);
        setActionError(null);
      }
      fetchData();
    } catch (err) {
      if (mountedRef.current) {
        setActionError((err as Error).message);
      }
    } finally {
      if (mountedRef.current) {
        setSearching(false);
      }
    }
  }, [id, fetchData]);

  const handleAddResult = useCallback(
    async (resultId: number) => {
      try {
        await addWatchlistResult(id, resultId);
        setActionError(null);
        fetchData();
      } catch (err) {
        setActionError((err as Error).message);
      }
    },
    [id, fetchData],
  );

  const handlePauseResume = useCallback(async () => {
    if (!entry) return;
    setActionLoading(true);
    try {
      const newStatus = entry.status === "paused" ? "watching" : "paused";
      await updateWatchlistEntry(id, { status: newStatus });
      setActionError(null);
      await fetchData();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      if (mountedRef.current) setActionLoading(false);
    }
  }, [id, entry, fetchData]);

  const openEdit = useCallback(() => {
    if (!entry) return;
    setEditForm({
      title: entry.title,
      mediaType: entry.mediaType,
      year: entry.year ? String(entry.year) : "",
      quality: entry.quality,
      seasonPattern: entry.seasonPattern || "",
      posterUrl: entry.posterUrl || "",
    });
    setShowEdit(true);
  }, [entry]);

  const handleEditSave = useCallback(async () => {
    if (!editForm.title.trim()) return;
    setActionLoading(true);
    try {
      await updateWatchlistEntry(id, {
        title: editForm.title.trim(),
        mediaType: editForm.mediaType,
        year: editForm.year ? parseInt(editForm.year) : undefined,
        quality: editForm.quality,
        seasonPattern: editForm.seasonPattern.trim() || undefined,
        posterUrl: editForm.posterUrl.trim() || undefined,
      });
      setActionError(null);
      setShowEdit(false);
      await fetchData();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      if (mountedRef.current) setActionLoading(false);
    }
  }, [id, editForm, fetchData]);

  const handleDelete = useCallback(async () => {
    if (!confirm("Remove this watchlist entry? This cannot be undone.")) return;
    setActionLoading(true);
    try {
      await deleteWatchlistEntry(id);
      router.push("/");
    } catch (err) {
      setActionError((err as Error).message);
      if (mountedRef.current) setActionLoading(false);
    }
  }, [id, router]);

  // ── Loading state ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          Loading watchlist entry...
        </div>
      </div>
    );
  }

  // ── Error / not found ──────────────────────────────────────────────────

  if (error || !entry) {
    return (
      <div className="p-8">
        <div className="rounded-xl border bg-card p-12 text-center shadow-sm">
          <p className="text-lg font-medium">Entry not found</p>
          <p className="text-sm text-muted-foreground mt-1">
            {error || `No watchlist entry with ID "${id}" exists.`}
          </p>
          <Link href="/">
            <button className="mt-4 inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent transition-colors">
              <ArrowLeft className="h-4 w-4" />
              Back to Watchlist
            </button>
          </Link>
        </div>
      </div>
    );
  }

  const badge = statusBadge(entry.status);
  const isPaused = entry.status === "paused";

  return (
    <div className="max-w-6xl mx-auto px-6 py-6 space-y-6 animate-card-enter">
      {/* ── Header bar ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleSearch}
            disabled={searching}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {searching ? (
              <div className="h-4 w-4 animate-spin border-2 border-primary-foreground border-t-transparent rounded-full" />
            ) : (
              <MagnifyingGlass className="h-4 w-4" weight="bold" />
            )}
            Search Now
          </button>

          {entry.status !== "fulfilled" && (
            <button
              onClick={handlePauseResume}
              disabled={actionLoading}
              className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent transition-colors disabled:opacity-50"
            >
              {isPaused ? (
                <>
                  <Play className="h-4 w-4" weight="fill" />
                  Resume
                </>
              ) : (
                <>
                  <Pause className="h-4 w-4" weight="fill" />
                  Pause
                </>
              )}
            </button>
          )}

          <button
            onClick={openEdit}
            disabled={actionLoading}
            className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent transition-colors disabled:opacity-50"
          >
            <PencilSimple className="h-4 w-4" />
            Edit
          </button>

          <button
            onClick={handleDelete}
            disabled={actionLoading}
            className="inline-flex items-center gap-2 rounded-md border border-red-500/30 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
          >
            <Trash className="h-4 w-4" />
            Remove
          </button>
        </div>
      </div>

      {/* ── Title card with poster ─────────────────────────────────────── */}
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <div className="flex gap-6">
          {/* Poster */}
          <div className="w-32 shrink-0 aspect-[2/3] rounded-xl overflow-hidden bg-muted">
            {entry.posterUrl ? (
              <img
                src={entry.posterUrl}
                alt={entry.title}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-muted to-muted/50">
                <FilmStrip className="h-8 w-8 text-muted-foreground/30" />
              </div>
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">
              {entry.title}
              {entry.year && (
                <span className="text-muted-foreground font-normal ml-2">
                  ({entry.year})
                </span>
              )}
            </h1>

            <div className="flex flex-wrap items-center gap-2 mt-3">
              <span className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium bg-neutral-500/15 text-neutral-400 border-neutral-500/30 capitalize">
                {entry.mediaType === "tv" ? (
                  <Television className="h-3 w-3" weight="fill" />
                ) : (
                  <FilmStrip className="h-3 w-3" weight="fill" />
                )}
                {entry.mediaType === "tv" ? "TV Show" : entry.mediaType}
              </span>
              <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium bg-purple-500/15 text-purple-400 border-purple-500/30">
                {entry.quality}
              </span>
              {entry.seasonPattern && (
                <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium bg-neutral-500/15 text-neutral-400 border-neutral-500/30">
                  {entry.seasonPattern}
                </span>
              )}
              <span
                className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${badge.className}`}
              >
                {badge.label}
              </span>
            </div>

            {entry.searchQuery && (
              <p className="mt-3 text-sm text-muted-foreground">
                <span className="text-xs uppercase tracking-wider mr-2 opacity-60">
                  Query
                </span>
                <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                  {entry.searchQuery}
                </code>
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Action Error ───────────────────────────────────────────────── */}
      {actionError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400 flex items-center justify-between">
          <span>{actionError}</span>
          <button
            onClick={() => setActionError(null)}
            className="text-red-400 hover:text-red-300 ml-4"
            aria-label="Dismiss error"
          >
            &times;
          </button>
        </div>
      )}

      {/* ── Fulfilled banner ───────────────────────────────────────────── */}
      {entry.status === "fulfilled" && entry.matchedTorrentId && (
        <div className="rounded-xl border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm flex items-center gap-3">
          <CheckCircle className="h-5 w-5 text-green-400 shrink-0" weight="fill" />
          <span className="text-green-400">
            Matched and added as torrent.
          </span>
          <Link
            href={`/torrents/${entry.matchedTorrentId}`}
            className="text-primary underline hover:no-underline ml-1"
          >
            View Torrent
          </Link>
        </div>
      )}

      {/* ── Info grid ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <InfoCard
          label="Search Query"
          value={entry.searchQuery}
          mono
        />
        <InfoCard
          icon={<Clock className="h-3.5 w-3.5 text-muted-foreground" />}
          label="Last Checked"
          value={formatTime(entry.lastCheckedAt)}
        />
        <InfoCard
          label="Last Match"
          value={formatTime(entry.lastMatchAt)}
        />
        <InfoCard
          label="Created"
          value={formatTime(entry.createdAt)}
        />
      </div>

      {/* ── Search Results ─────────────────────────────────────────────── */}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="text-sm font-semibold">
            Search Results
            {results.length > 0 && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                ({results.length} found)
              </span>
            )}
          </h2>
        </div>

        {results.length === 0 ? (
          <div className="py-12 text-center">
            <MagnifyingGlass className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              No search results yet. Click &quot;Search Now&quot; to find matches.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Title</th>
                  <th className="px-5 py-3 font-medium">Seeders</th>
                  <th className="px-5 py-3 font-medium">Size</th>
                  <th className="px-5 py-3 font-medium">Quality Match</th>
                  <th className="px-5 py-3 font-medium">Indexer</th>
                  <th className="px-5 py-3 font-medium">Date</th>
                  <th className="px-5 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {results.map((result, idx) => (
                  <ResultRow
                    key={result.id ?? idx}
                    result={result}
                    onAdd={handleAddResult}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit Watchlist Modal */}
      {showEdit && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-slide-up" onClick={() => setShowEdit(false)}>
          <div className="bg-card rounded-xl p-5 max-w-md w-full space-y-3 shadow-xl border" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold">Edit Watchlist Entry</h3>
            <input
              type="text"
              placeholder="Title"
              value={editForm.title}
              onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded-md border bg-background"
            />
            <div className="flex gap-2">
              <select
                value={editForm.mediaType}
                onChange={(e) => setEditForm({ ...editForm, mediaType: e.target.value as WatchlistRecord["mediaType"] })}
                className="flex-1 px-3 py-2 text-sm rounded-md border bg-background"
              >
                <option value="movie">Movie</option>
                <option value="tv">TV Show</option>
                <option value="music">Music</option>
                <option value="game">Game</option>
                <option value="book">Book</option>
                <option value="app">App</option>
                <option value="other">Other</option>
              </select>
              <input
                type="number"
                placeholder="Year"
                value={editForm.year}
                onChange={(e) => setEditForm({ ...editForm, year: e.target.value })}
                className="w-24 px-3 py-2 text-sm rounded-md border bg-background"
              />
            </div>
            <input
              type="text"
              placeholder="Quality (e.g. 1080p)"
              value={editForm.quality}
              onChange={(e) => setEditForm({ ...editForm, quality: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded-md border bg-background"
            />
            <input
              type="text"
              placeholder="Season pattern (e.g. S01) — optional"
              value={editForm.seasonPattern}
              onChange={(e) => setEditForm({ ...editForm, seasonPattern: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded-md border bg-background"
            />
            <input
              type="text"
              placeholder="Poster URL — optional"
              value={editForm.posterUrl}
              onChange={(e) => setEditForm({ ...editForm, posterUrl: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded-md border bg-background"
            />
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setShowEdit(false)}
                className="flex-1 px-4 py-2 text-sm rounded-md border hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleEditSave}
                disabled={actionLoading || !editForm.title.trim()}
                className="flex-1 px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {actionLoading ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Info Card ────────────────────────────────────────────────────────────

function InfoCard({
  label,
  value,
  mono = false,
  icon,
}: {
  label: string;
  value: string;
  mono?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-1.5">
        {icon}
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
      <p
        className={`mt-1 text-sm font-medium truncate ${mono ? "font-mono text-xs" : ""}`}
        title={value}
      >
        {value}
      </p>
    </div>
  );
}

// ── Result Row ───────────────────────────────────────────────────────────

function ResultRow({
  result,
  onAdd,
}: {
  result: WatchlistResultRecord;
  onAdd: (resultId: number) => void;
}) {
  const [adding, setAdding] = useState(false);

  const handleAdd = async () => {
    setAdding(true);
    await onAdd(result.id);
    setAdding(false);
  };

  return (
    <tr className="border-b last:border-b-0 hover:bg-muted/50 transition-colors">
      <td className="px-5 py-3">
        <p className="font-medium truncate max-w-md" title={result.title}>
          {result.title}
        </p>
      </td>
      <td className="px-5 py-3">
        <span className="text-green-600 dark:text-green-400 font-medium">{result.seeders}</span>
        <span className="text-muted-foreground mx-1">/</span>
        <span className="text-red-600 dark:text-red-400">{result.leechers}</span>
      </td>
      <td className="px-5 py-3 text-muted-foreground">{formatBytes(result.size)}</td>
      <td className="px-5 py-3">
        <span className={`font-medium ${qualityMatchColor(result.qualityMatch)}`}>
          {result.qualityMatch}%
        </span>
      </td>
      <td className="px-5 py-3 text-muted-foreground">{result.indexer || "-"}</td>
      <td className="px-5 py-3 text-muted-foreground text-xs">{formatTime(result.publishDate)}</td>
      <td className="px-5 py-3 text-right">
        {result.wasSelected ? (
          <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
            <CheckCircle className="h-3.5 w-3.5" weight="fill" />
            Added
          </span>
        ) : (
          <button
            onClick={handleAdd}
            disabled={adding}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {adding ? (
              <div className="h-3 w-3 animate-spin border-2 border-primary-foreground border-t-transparent rounded-full" />
            ) : (
              <Plus className="h-3 w-3" weight="bold" />
            )}
            Add as Torrent
          </button>
        )}
      </td>
    </tr>
  );
}
