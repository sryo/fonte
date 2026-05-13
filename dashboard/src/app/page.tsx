"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  getTorrents,
  getWatchlist,
  getAutomations,
  getTorrentStats,
} from "@/lib/api";
import type {
  TorrentRecord,
  WatchlistRecord,
  AutomationRule,
  TorrentStats,
} from "@/lib/api";
import { formatBytes, formatSpeed } from "@/lib/format";
import {
  DownloadSimple,
  Eye,
  Lightning,
  Check,
  FilmStrip,
  Plus,
  Trash,
  Pause,
  Stop,
  MagnifyingGlass,
  X,
  Play,
} from "@phosphor-icons/react";
import {
  addWatchlistEntry,
  removeTorrent,
  deleteWatchlistEntry,
  createAutomation,
  pauseTorrent,
  resumeTorrent,
  triggerWatchlistSearch,
} from "@/lib/api";

// ── Filter types ─────────────────────────────────────────────────────────

type FilterChip = "all" | "downloading" | "completed" | "watching";

const FILTER_CHIPS: { key: FilterChip; label: string }[] = [
  { key: "all", label: "All" },
  { key: "downloading", label: "Downloading" },
  { key: "completed", label: "Completed" },
  { key: "watching", label: "Watching" },
];

// ── Helpers ──────────────────────────────────────────────────────────────

function relativeTime(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ── CardAction (hover action button) ────────────────────────────────────

function CardAction({ icon: Icon, label, onClick, destructive }: {
  icon: React.ElementType;
  label: string;
  onClick: (e: React.MouseEvent) => void;
  destructive?: boolean;
}) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(e); }}
      title={label}
      className={cn(
        "h-8 w-8 rounded-lg flex items-center justify-center backdrop-blur-sm transition-colors",
        destructive
          ? "bg-red-500/80 hover:bg-red-500 text-white"
          : "bg-white/20 hover:bg-white/30 text-white"
      )}
    >
      <Icon className="h-4 w-4" weight="bold" />
    </button>
  );
}

// ── MediaCard (unified card layout) ──────────────────────────────────────

function MediaCard({
  posterUrl,
  title,
  badges,
  actions,
  onClick,
  children,
}: {
  posterUrl?: string;
  title: string;
  badges?: React.ReactNode;
  actions?: React.ReactNode;
  onClick?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") onClick?.(); }}
      className="w-44 rounded-xl shadow-sm border bg-card overflow-hidden text-left hover:bg-accent/50 transition-colors group cursor-pointer"
    >
      <div className="aspect-[2/3] w-full bg-muted relative overflow-hidden">
        {posterUrl ? (
          <img src={posterUrl} alt={title} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-muted to-muted/50">
            <FilmStrip className="h-10 w-10 text-muted-foreground/30" />
          </div>
        )}
        {badges && (
          <div className="absolute bottom-2 left-2 right-2 flex flex-wrap gap-1">
            {badges}
          </div>
        )}
        {actions && (
          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-end p-2 gap-1.5">
            {actions}
          </div>
        )}
      </div>
      <div className="p-3 space-y-1">
        <p className="text-sm font-medium leading-tight line-clamp-2 group-hover:text-foreground">{title}</p>
        {children}
      </div>
    </div>
  );
}

// ── Status Badge ─────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    downloading: "bg-torrent/15 text-torrent",
    seeding: "bg-green-500/15 text-green-600 dark:text-green-400",
    completed: "bg-green-500/15 text-green-600 dark:text-green-400",
    paused: "bg-muted text-muted-foreground",
    error: "bg-destructive/15 text-destructive",
    watching: "bg-watchlist/15 text-watchlist",
    fulfilled: "bg-green-500/15 text-green-600 dark:text-green-400",
  };

  return (
    <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded-md capitalize", styles[status] ?? "bg-muted text-muted-foreground")}>
      {status}
    </span>
  );
}

// ── Content Row ──────────────────────────────────────────────────────────

function ContentRow({
  title,
  count,
  icon: Icon,
  children,
  emptyMessage,
  isEmpty,
  action,
}: {
  title: string;
  count: number;
  icon: React.ElementType;
  children: React.ReactNode;
  emptyMessage: string;
  isEmpty: boolean;
  action?: React.ReactNode;
}) {
  return (
    <section className="space-y-3 animate-card-enter">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Icon className="h-5 w-5 text-muted-foreground" weight="bold" />
          {title}
          {count > 0 && (
            <span className="text-sm font-normal text-muted-foreground">({count})</span>
          )}
        </h2>
        {action}
      </div>
      {isEmpty ? (
        <p className="text-sm text-muted-foreground py-6 text-center">{emptyMessage}</p>
      ) : (
        <div className="flex flex-wrap gap-3">{children}</div>
      )}
    </section>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────

export default function HomePage() {
  const router = useRouter();
  const [filter, setFilter] = useState<FilterChip>("all");

  const [torrents, setTorrents] = useState<TorrentRecord[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistRecord[]>([]);
  const [automations, setAutomations] = useState<AutomationRule[]>([]);
  const [stats, setStats] = useState<TorrentStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddWatchlist, setShowAddWatchlist] = useState(false);
  const [showAddAutomation, setShowAddAutomation] = useState(false);
  const [autoForm, setAutoForm] = useState({
    name: "",
    triggerType: "torrent:completed",
    prompt: "",
  });
  const [wlForm, setWlForm] = useState({ title: "", mediaType: "movie" as "movie" | "tv" | "music" | "game" | "book" | "app" | "other", year: "", quality: "1080p" });

  const fetchAll = useCallback(async () => {
    try {
      const [torrentsRes, watchlistRes, automationsRes, statsRes] = await Promise.all([
        getTorrents(),
        getWatchlist(),
        getAutomations(),
        getTorrentStats(),
      ]);
      setTorrents(torrentsRes.torrents);
      setWatchlist(watchlistRes.entries);
      setAutomations(automationsRes.rules);
      setStats(statsRes);
    } catch {
      /* silently ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 3000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  // ── Derived data ───────────────────────────────────────────────────────

  const activeTorrents = torrents.filter(
    (t) => t.status === "downloading" || t.status === "seeding" || t.status === "paused"
  );

  const completedTorrents = torrents
    .filter((t) => t.status === "completed")
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
    .slice(0, 10);

  const watchingEntries = watchlist.filter((w) => w.status === "watching");

  const enabledAutomations = automations.filter((a) => a.enabled);

  // ── Visibility based on filter ─────────────────────────────────────────

  const showDownloading = filter === "all" || filter === "downloading";
  const showCompleted = filter === "all" || filter === "completed";
  const showWatching = filter === "all" || filter === "watching";
  const showAutomations = filter === "all";

  // ── Render ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-pulse text-muted-foreground text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-6 space-y-8 animate-card-enter">
      {/* Quick filter chips */}
      <div className="flex items-center gap-2 flex-wrap" role="tablist">
        {FILTER_CHIPS.map(({ key, label }) => (
          <button
            key={key}
            role="tab"
            aria-selected={filter === key}
            onClick={() => setFilter(key)}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
              filter === key
                ? "bg-foreground text-background"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Row 1: Active Downloads */}
      {showDownloading && (
        <ContentRow
          title="Active Downloads"
          count={activeTorrents.length}
          icon={DownloadSimple}
          emptyMessage="No active downloads"
          isEmpty={activeTorrents.length === 0}
        >
          {activeTorrents.map((torrent) => (
            <MediaCard
              key={torrent.id}
              title={torrent.name}
              onClick={() => router.push(`/torrents/${torrent.id}`)}
              badges={
                <>
                  <StatusBadge status={torrent.status} />
                  <span className="text-[10px] bg-black/60 text-white px-1.5 py-0.5 rounded-full">
                    {Math.round(torrent.progress * 100)}%
                  </span>
                </>
              }
              actions={
                <>
                  {torrent.status === "downloading" && (
                    <CardAction icon={Pause} label="Pause" onClick={() => { pauseTorrent(torrent.id); fetchAll(); }} />
                  )}
                  {torrent.status === "seeding" && (
                    <CardAction icon={Stop} label="Stop seeding" onClick={() => { pauseTorrent(torrent.id); fetchAll(); }} />
                  )}
                  {torrent.status === "paused" && (
                    <CardAction icon={Play} label="Resume" onClick={() => { resumeTorrent(torrent.id); fetchAll(); }} />
                  )}
                  <CardAction icon={X} label="Remove" destructive onClick={() => {
                    if (confirm(`Remove "${torrent.name}"?`)) { removeTorrent(torrent.id); fetchAll(); }
                  }} />
                </>
              }
            >
              <p className="text-[11px] text-muted-foreground">
                <span className="text-torrent">&darr; {formatSpeed(torrent.downloadSpeed)}</span>
                {" \u00B7 "}{torrent.numPeers} peers
              </p>
            </MediaCard>
          ))}
        </ContentRow>
      )}

      {/* Row 2: Watchlist */}
      {showWatching && (
        <ContentRow
          title="Watchlist"
          count={watchingEntries.length}
          icon={Eye}
          emptyMessage="Nothing on your watchlist"
          isEmpty={watchingEntries.length === 0}
          action={
            <button
              onClick={() => setShowAddWatchlist(true)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors rounded-lg px-2.5 py-1.5 hover:bg-muted"
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </button>
          }
        >
          {watchingEntries.map((entry) => (
            <MediaCard
              key={entry.id}
              title={entry.title}
              posterUrl={entry.posterUrl}
              onClick={() => router.push(`/watchlist/${entry.id}`)}
              badges={
                <>
                  <StatusBadge status={entry.status} />
                  <span className="text-[10px] bg-black/60 text-white px-1.5 py-0.5 rounded-full">
                    {entry.quality}
                  </span>
                </>
              }
              actions={
                <>
                  <CardAction icon={MagnifyingGlass} label="Search now" onClick={() => { triggerWatchlistSearch(entry.id); fetchAll(); }} />
                  <CardAction icon={X} label="Remove" destructive onClick={() => {
                    if (confirm(`Remove "${entry.title}" from watchlist?`)) { deleteWatchlistEntry(entry.id); fetchAll(); }
                  }} />
                </>
              }
            >
              <p className="text-[11px] text-muted-foreground">
                {entry.year && `${entry.year} \u00B7 `}{entry.mediaType === "tv" ? "TV Show" : entry.mediaType.charAt(0).toUpperCase() + entry.mediaType.slice(1)}
              </p>
            </MediaCard>
          ))}
        </ContentRow>
      )}

      {/* Row 3: Recently Completed */}
      {showCompleted && (
        <ContentRow
          title="Recently Completed"
          count={completedTorrents.length}
          icon={Check}
          emptyMessage="No completed downloads yet"
          isEmpty={completedTorrents.length === 0}
          action={completedTorrents.length > 0 ? (
            <button
              onClick={async () => {
                if (!confirm(`Remove ${completedTorrents.length} completed torrents from list?`)) return;
                for (const t of completedTorrents) {
                  await removeTorrent(t.id);
                }
                fetchAll();
              }}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive transition-colors rounded-lg px-2.5 py-1.5 hover:bg-muted"
            >
              <Trash className="h-3.5 w-3.5" />
              Clear
            </button>
          ) : undefined}
        >
          {completedTorrents.map((torrent) => (
            <MediaCard
              key={torrent.id}
              title={torrent.name}
              onClick={() => router.push(`/torrents/${torrent.id}`)}
              badges={
                <span className="text-[10px] bg-green-500/80 text-white px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                  <Check className="h-2.5 w-2.5" weight="bold" /> Done
                </span>
              }
              actions={
                <CardAction icon={X} label="Remove" destructive onClick={() => { removeTorrent(torrent.id); fetchAll(); }} />
              }
            >
              <p className="text-[11px] text-muted-foreground">
                {formatBytes(torrent.size)}
                {torrent.completedAt && ` \u00B7 ${relativeTime(torrent.completedAt)}`}
              </p>
            </MediaCard>
          ))}
        </ContentRow>
      )}

      {/* Row 4: Automations */}
      {showAutomations && (
        <ContentRow
          title="Automations"
          count={enabledAutomations.length}
          icon={Lightning}
          emptyMessage="No automations configured"
          isEmpty={enabledAutomations.length === 0}
          action={
            <button
              onClick={() => setShowAddAutomation(true)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors rounded-lg px-2.5 py-1.5 hover:bg-muted"
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </button>
          }
        >
          {enabledAutomations.map((rule) => (
            <div key={rule.id} className="w-56 rounded-xl shadow-sm border bg-card p-4">
              <p className="text-sm font-medium leading-tight line-clamp-1">{rule.name}</p>
              <div className="mt-2">
                <span className="text-[10px] bg-automation/15 text-automation px-1.5 py-0.5 rounded-full">
                  {rule.triggerType.replace(":", " ")}
                </span>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground line-clamp-3">
                {rule.prompt}
              </p>
              <p className="mt-2 text-[10px] text-muted-foreground">
                Triggered {rule.triggerCount} time{rule.triggerCount !== 1 ? "s" : ""}
              </p>
            </div>
          ))}
        </ContentRow>
      )}

      {/* Add to Watchlist Modal */}
      {showAddWatchlist && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onClick={() => setShowAddWatchlist(false)}>
          <div className="bg-card rounded-xl shadow-lg border p-6 w-full max-w-sm space-y-4 animate-card-enter" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold">Add to Watchlist</h3>
            <input
              placeholder="Title (e.g. Kika)"
              value={wlForm.title}
              onChange={(e) => setWlForm({ ...wlForm, title: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded-lg border bg-background"
              autoFocus
            />
            <div className="grid grid-cols-2 gap-3">
              <select
                value={wlForm.mediaType}
                onChange={(e) => setWlForm({ ...wlForm, mediaType: e.target.value as "movie" | "tv" | "music" | "game" | "book" | "app" | "other" })}
                className="px-3 py-2 text-sm rounded-lg border bg-background"
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
                placeholder="Year"
                type="number"
                value={wlForm.year}
                onChange={(e) => setWlForm({ ...wlForm, year: e.target.value })}
                className="px-3 py-2 text-sm rounded-lg border bg-background"
              />
            </div>
            <select
              value={wlForm.quality}
              onChange={(e) => setWlForm({ ...wlForm, quality: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded-lg border bg-background"
            >
              <option value="720p">720p</option>
              <option value="1080p">1080p</option>
              <option value="4K">4K</option>
            </select>
            <div className="flex gap-2 pt-1">
              <button
                onClick={async () => {
                  if (!wlForm.title.trim()) return;
                  await addWatchlistEntry({
                    title: wlForm.title.trim(),
                    mediaType: wlForm.mediaType,
                    year: wlForm.year ? parseInt(wlForm.year) : undefined,
                    quality: wlForm.quality,
                  });
                  setWlForm({ title: "", mediaType: "movie", year: "", quality: "1080p" });
                  setShowAddWatchlist(false);
                  fetchAll();
                }}
                disabled={!wlForm.title.trim()}
                className="flex-1 px-4 py-2 text-sm bg-watchlist text-watchlist-foreground rounded-lg hover:opacity-90 disabled:opacity-50"
              >
                Add
              </button>
              <button
                onClick={() => setShowAddWatchlist(false)}
                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Automation Modal */}
      {showAddAutomation && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onClick={() => setShowAddAutomation(false)}>
          <div className="bg-card rounded-xl shadow-lg border p-6 w-full max-w-md space-y-4 animate-card-enter" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold">Create Automation</h3>
            <input
              placeholder="Rule name"
              value={autoForm.name}
              onChange={(e) => setAutoForm({ ...autoForm, name: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded-lg border bg-background"
              autoFocus
            />
            <div>
              <label className="text-xs text-muted-foreground">When this happens...</label>
              <select
                value={autoForm.triggerType}
                onChange={(e) => setAutoForm({ ...autoForm, triggerType: e.target.value })}
                className="w-full px-3 py-2 text-sm rounded-lg border bg-background mt-1"
              >
                <option value="torrent:completed">Torrent completes</option>
                <option value="torrent:added">Torrent added</option>
                <option value="torrent:error">Torrent error</option>
                <option value="torrent:stalled">Torrent stalled</option>
                <option value="watchlist:match">Watchlist match found</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Describe what should happen...</label>
              <textarea
                placeholder="e.g., Fetch subtitles in the original language, translate to Spanish, clean up the file name, and move to the right folder based on type."
                value={autoForm.prompt}
                onChange={(e) => setAutoForm({ ...autoForm, prompt: e.target.value })}
                rows={4}
                className="w-full px-3 py-2 text-sm rounded-lg border bg-background mt-1 resize-y"
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={async () => {
                  if (!autoForm.name.trim()) return;
                  await createAutomation({
                    name: autoForm.name.trim(),
                    prompt: autoForm.prompt.trim(),
                    triggerType: autoForm.triggerType,
                  });
                  setAutoForm({ name: "", triggerType: "torrent:completed", prompt: "" });
                  setShowAddAutomation(false);
                  fetchAll();
                }}
                disabled={!autoForm.name.trim()}
                className="flex-1 px-4 py-2 text-sm bg-automation text-automation-foreground rounded-lg hover:opacity-90 disabled:opacity-50"
              >
                Create
              </button>
              <button
                onClick={() => setShowAddAutomation(false)}
                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
