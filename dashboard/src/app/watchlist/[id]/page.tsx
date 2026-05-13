"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  getWatchlistEntry,
  triggerWatchlistSearch,
  addWatchlistResult,
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
      return { label: "Watching", className: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" };
    case "fulfilled":
      return { label: "Fulfilled", className: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" };
    case "paused":
      return { label: "Paused", className: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300" };
    default:
      return { label: status, className: "bg-muted text-muted-foreground" };
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
  const id = params.id as string;

  const [entry, setEntry] = useState<WatchlistRecord | null>(null);
  const [results, setResults] = useState<WatchlistResultRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
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

  if (loading) {
    return (
      <div className="p-8">
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center">
          <div className="h-4 w-4 animate-spin border-2 border-primary border-t-transparent rounded-full" />
          Loading watchlist entry...
        </div>
      </div>
    );
  }

  if (error || !entry) {
    return (
      <div className="p-8">
        <div className="py-12 text-center">
          <p className="text-sm text-destructive">{error || "Entry not found"}</p>
          <Link
            href="/watchlist"
            className="mt-3 inline-block text-sm text-primary underline hover:no-underline"
          >
            Back to Watchlist
          </Link>
        </div>
      </div>
    );
  }

  const badge = statusBadge(entry.status);

  return (
    <div className="max-w-6xl mx-auto px-6 py-6 space-y-6">
      {/* Back link + Header */}
      <div>
        <Link
          href="/watchlist"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
          Back to Watchlist
        </Link>

        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {entry.title}
              {entry.year && (
                <span className="text-muted-foreground font-normal ml-2">({entry.year})</span>
              )}
            </h1>
            <div className="flex items-center gap-2 mt-2">
              <span className="inline-block px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground">
                {entry.mediaType === "tv" ? "TV" : "Movie"}
              </span>
              <span className="inline-block px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground">
                {entry.quality}
              </span>
              <span className={`inline-block px-2 py-0.5 text-xs font-medium ${badge.className}`}>
                {badge.label}
              </span>
            </div>
          </div>

          <button
            onClick={handleSearch}
            disabled={searching}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {searching ? (
              <div className="h-4 w-4 animate-spin border-2 border-primary-foreground border-t-transparent rounded-full" />
            ) : (
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
            )}
            Search Now
          </button>
        </div>
      </div>

      {/* Info Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {entry.seasonPattern && (
          <div className="border bg-card p-4">
            <p className="text-xs text-muted-foreground mb-1">Season</p>
            <p className="text-sm font-medium">{entry.seasonPattern}</p>
          </div>
        )}
        <div className="border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1">Search Query</p>
          <p className="text-sm font-medium font-mono truncate" title={entry.searchQuery}>
            {entry.searchQuery}
          </p>
        </div>
        <div className="border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1">Added</p>
          <p className="text-sm font-medium">{formatTime(entry.createdAt)}</p>
        </div>
        <div className="border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1">Last Checked</p>
          <p className="text-sm font-medium">{formatTime(entry.lastCheckedAt)}</p>
        </div>
        <div className="border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1">Last Match</p>
          <p className="text-sm font-medium">{formatTime(entry.lastMatchAt)}</p>
        </div>
      </div>

      {/* Fulfilled: link to matched torrent */}
      {entry.status === "fulfilled" && entry.matchedTorrentId && (
        <div className="flex items-center gap-3 px-4 py-3 border bg-green-50 dark:bg-green-950 text-sm">
          <svg className="h-5 w-5 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
          <span className="text-green-700 dark:text-green-300">
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

      {/* Search Results */}
      <div>
        <h2 className="text-lg font-semibold mb-3">
          Search Results
          {results.length > 0 && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              ({results.length} found)
            </span>
          )}
        </h2>

        {results.length === 0 ? (
          <div className="py-8 text-center border bg-card">
            <svg
              className="h-8 w-8 text-muted-foreground mx-auto mb-3"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
            <p className="text-sm text-muted-foreground">
              No search results yet. Click &quot;Search Now&quot; to find matches.
            </p>
          </div>
        ) : (
          <div className="border bg-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Title</th>
                  <th className="px-4 py-3 font-medium">Seeders</th>
                  <th className="px-4 py-3 font-medium">Size</th>
                  <th className="px-4 py-3 font-medium">Quality Match</th>
                  <th className="px-4 py-3 font-medium">Indexer</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {results.map((result) => (
                  <ResultRow
                    key={result.id}
                    result={result}
                    onAdd={handleAddResult}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
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
      <td className="px-4 py-3">
        <p className="font-medium truncate max-w-md" title={result.title}>
          {result.title}
        </p>
      </td>
      <td className="px-4 py-3">
        <span className="text-green-600 dark:text-green-400 font-medium">{result.seeders}</span>
        <span className="text-muted-foreground mx-1">/</span>
        <span className="text-red-600 dark:text-red-400">{result.leechers}</span>
      </td>
      <td className="px-4 py-3 text-muted-foreground">{formatBytes(result.size)}</td>
      <td className="px-4 py-3">
        <span className={`font-medium ${qualityMatchColor(result.qualityMatch)}`}>
          {result.qualityMatch}%
        </span>
      </td>
      <td className="px-4 py-3 text-muted-foreground">{result.indexer || "-"}</td>
      <td className="px-4 py-3 text-muted-foreground text-xs">{formatTime(result.publishDate)}</td>
      <td className="px-4 py-3 text-right">
        {result.wasSelected ? (
          <span className="inline-block px-2 py-1 text-xs text-green-600 dark:text-green-400">
            Added
          </span>
        ) : (
          <button
            onClick={handleAdd}
            disabled={adding}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {adding ? (
              <div className="h-3 w-3 animate-spin border-2 border-primary-foreground border-t-transparent rounded-full" />
            ) : (
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            )}
            Add as Torrent
          </button>
        )}
      </td>
    </tr>
  );
}
