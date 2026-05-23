"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  getTorrents,
  getWatchlist,
  getAutomations,
  getTorrentStats,
  getIndexerStatus,
} from "@/lib/api";
import type {
  TorrentRecord,
  WatchlistRecord,
  AutomationRule,
  TorrentStats,
  IndexerStatus,
} from "@/lib/api";
import { formatBytes, formatSpeed, formatRelativeTime } from "@/lib/format";
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
  Play,
  Plug,
  X,
} from "@phosphor-icons/react";
import {
  addWatchlistEntry,
  removeTorrent,
  deleteWatchlistEntry,
  createAutomation,
  updateAutomation,
  getAutomation,
  triggerAutomation,
  deleteAutomation,
  type AutomationLog,
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
  progress,
}: {
  posterUrl?: string;
  title: string;
  badges?: React.ReactNode;
  actions?: React.ReactNode;
  onClick?: () => void;
  children?: React.ReactNode;
  progress?: { value: number; stalled?: boolean };
}) {
  const showBar = progress && progress.value < 1;
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
      {showBar && (
        <div className="h-1 bg-muted">
          <div
            className={cn(
              "h-full bg-torrent transition-all duration-500",
              progress!.stalled ? "opacity-40" : "animate-xp-stripes"
            )}
            style={{ width: `${Math.min(100, progress!.value * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

// ── Empty Row Card ───────────────────────────────────────────────────────

function EmptyRowCard({
  icon: Icon,
  label,
  hint,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  hint?: string;
  onClick?: () => void;
}) {
  const interactive = Boolean(onClick);
  return (
    <div
      onClick={onClick}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={interactive ? (e) => { if (e.key === "Enter") onClick?.(); } : undefined}
      className={cn(
        "w-44 rounded-xl border border-dashed bg-card/30 overflow-hidden text-left transition-colors",
        interactive && "hover:bg-accent/50 hover:border-foreground/30 cursor-pointer"
      )}
    >
      <div className="aspect-[2/3] w-full flex items-center justify-center bg-gradient-to-br from-muted/30 to-transparent">
        <Icon className="h-12 w-12 text-muted-foreground/40" weight="thin" />
      </div>
      <div className="p-3 space-y-1">
        <p className="text-sm font-medium leading-tight text-muted-foreground">{label}</p>
        {hint && <p className="text-[11px] text-muted-foreground/70 leading-tight">{hint}</p>}
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
  emptyContent,
  isEmpty,
  action,
}: {
  title: string;
  count: number;
  icon: React.ElementType;
  children: React.ReactNode;
  emptyContent: React.ReactNode;
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
        <div className="flex flex-wrap gap-3">{emptyContent}</div>
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
  const [indexerStatus, setIndexerStatus] = useState<IndexerStatus | null>(null);
  const [indexerBannerDismissed, setIndexerBannerDismissed] = useState(false);
  const [showAddWatchlist, setShowAddWatchlist] = useState(false);
  const [showAddAutomation, setShowAddAutomation] = useState(false);
  const [autoForm, setAutoForm] = useState({
    name: "",
    triggerType: "torrent:completed",
    prompt: "",
  });
  const [editAutoId, setEditAutoId] = useState<string | null>(null);
  const [editAutoForm, setEditAutoForm] = useState({
    name: "",
    triggerType: "torrent:completed",
    cron: "",
    prompt: "",
  });
  const [runningAutoId, setRunningAutoId] = useState<string | null>(null);
  const [editAutoLogs, setEditAutoLogs] = useState<AutomationLog[]>([]);
  const [editAutoLastResponse, setEditAutoLastResponse] = useState<{ text: string; ts: number } | null>(null);
  const [wlForm, setWlForm] = useState({ title: "", mediaType: "movie" as "movie" | "tv" | "music" | "game" | "book" | "app" | "other", year: "", quality: "1080p" });

  // Per-torrent progress history: id → { progress: 0-1, ts: ms since epoch when last changed }
  const progressHistoryRef = useRef<Map<string, { progress: number; ts: number }>>(new Map());
  const STALL_MS = 30_000;

  const fetchAll = useCallback(async () => {
    try {
      const [torrentsRes, watchlistRes, automationsRes, statsRes] = await Promise.all([
        getTorrents(),
        getWatchlist(),
        getAutomations(),
        getTorrentStats(),
      ]);
      const newTorrents = torrentsRes.torrents;
      const now = Date.now();
      const history = progressHistoryRef.current;
      const seen = new Set<string>();
      for (const t of newTorrents) {
        seen.add(t.id);
        const prev = history.get(t.id);
        if (!prev || t.progress > prev.progress) {
          history.set(t.id, { progress: t.progress, ts: now });
        }
      }
      for (const id of history.keys()) {
        if (!seen.has(id)) history.delete(id);
      }
      setTorrents(newTorrents);
      setWatchlist(watchlistRes.entries);
      setAutomations(automationsRes.rules);
      setStats(statsRes);
    } catch {
      /* silently ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  const isStalled = useCallback((torrent: TorrentRecord): boolean => {
    if (torrent.status !== "downloading") return false;
    if (torrent.progress >= 1) return false;
    const entry = progressHistoryRef.current.get(torrent.id);
    if (!entry) return false;
    return Date.now() - entry.ts > STALL_MS;
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 3000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  // Indexer status is a real Jackett search on every call; check once on
  // mount instead of every poll tick, and respect a persisted dismissal.
  useEffect(() => {
    if (typeof window !== "undefined") {
      setIndexerBannerDismissed(localStorage.getItem("fonte.indexer-banner-dismissed") === "true");
    }
    getIndexerStatus().then(setIndexerStatus).catch(() => {});
  }, []);

  const dismissIndexerBanner = () => {
    if (typeof window !== "undefined") {
      localStorage.setItem("fonte.indexer-banner-dismissed", "true");
    }
    setIndexerBannerDismissed(true);
  };

  const showIndexerBanner = indexerStatus !== null && !indexerStatus.configured && !indexerBannerDismissed;

  // ── Derived data ───────────────────────────────────────────────────────

  const activeTorrents = torrents.filter(
    (t) => t.status === "downloading" || t.status === "paused"
  );

  // Seeding torrents have finished downloading; group them with completed so
  // the user sees finished work in one place. Transmission only reports the
  // transient "completed" status briefly before the daemon flips it to
  // "seeding", so without this Recently Completed is almost always empty.
  const completedTorrents = torrents
    .filter((t) => t.status === "completed" || t.status === "seeding")
    .sort((a, b) => (b.completedAt ?? b.addedAt ?? 0) - (a.completedAt ?? a.addedAt ?? 0))
    .slice(0, 10);

  const watchingEntries = watchlist.filter((w) => w.status === "watching");

  const enabledAutomations = automations.filter((a) => a.enabled);

  // If the user was viewing the Completed filter and the row drains, fall
  // back to "all" — the chip we render is also hidden in that state.
  useEffect(() => {
    if (filter === "completed" && completedTorrents.length === 0) {
      setFilter("all");
    }
  }, [filter, completedTorrents.length]);

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
      {/* First-run nudge: no indexers configured in Jackett */}
      {showIndexerBanner && (
        <div className="rounded-xl border bg-card p-4 flex items-center gap-3">
          <Plug className="h-5 w-5 text-muted-foreground shrink-0" weight="bold" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">No indexers configured</p>
            <p className="text-xs text-muted-foreground">
              Fonte ships with none enabled. Open Jackett to pick which trackers to use.
            </p>
          </div>
          <a
            href={indexerStatus?.jackettUrl || "http://localhost:9117"}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-foreground text-background hover:opacity-90 transition-opacity shrink-0"
          >
            Open Jackett
          </a>
          <button
            onClick={dismissIndexerBanner}
            aria-label="Dismiss"
            className="text-muted-foreground hover:text-foreground transition-colors shrink-0 p-1"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Quick filter chips — hide ones that point at empty rows */}
      <div className="flex items-center gap-2 flex-wrap" role="tablist">
        {FILTER_CHIPS.filter(({ key }) => key !== "completed" || completedTorrents.length > 0).map(({ key, label }) => (
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
          isEmpty={activeTorrents.length === 0}
          emptyContent={
            <EmptyRowCard
              icon={DownloadSimple}
              label="Add a torrent"
              hint="Click a magnet link or open a .torrent file"
            />
          }
        >
          {activeTorrents.map((torrent) => (
            <MediaCard
              key={torrent.id}
              title={torrent.name}
              onClick={() => router.push(`/torrents/${torrent.id}`)}
              progress={{ value: torrent.progress, stalled: isStalled(torrent) }}
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
                  {torrent.status === "paused" && (
                    <CardAction icon={Play} label="Resume" onClick={() => { resumeTorrent(torrent.id); fetchAll(); }} />
                  )}
                  <CardAction icon={Trash} label="Remove" destructive onClick={() => {
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
          isEmpty={watchingEntries.length === 0}
          emptyContent={
            <EmptyRowCard
              icon={Eye}
              label="Watch for a release"
              hint="We'll grab it when it shows up"
              onClick={() => setShowAddWatchlist(true)}
            />
          }
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
                  <CardAction
                    icon={MagnifyingGlass}
                    label={entry.lastCheckedAt ? `Search now\nLast searched: ${formatRelativeTime(entry.lastCheckedAt)}` : "Search now\nNever searched"}
                    onClick={() => { triggerWatchlistSearch(entry.id); fetchAll(); }}
                  />
                  <CardAction icon={Trash} label="Remove" destructive onClick={() => {
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

      {/* Row 3: Recently Completed — hidden until there's something to show */}
      {showCompleted && completedTorrents.length > 0 && (
        <ContentRow
          title="Recently Completed"
          count={completedTorrents.length}
          icon={Check}
          isEmpty={false}
          emptyContent={null}
          action={completedTorrents.length > 0 ? (
            <button
              onClick={async () => {
                await Promise.all(completedTorrents.map((t) => removeTorrent(t.id)));
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
                torrent.status === "seeding" ? (
                  <span className="text-[10px] bg-green-500/80 text-white px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                    <Check className="h-2.5 w-2.5" weight="bold" /> Seeding
                  </span>
                ) : (
                  <span className="text-[10px] bg-green-500/80 text-white px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                    <Check className="h-2.5 w-2.5" weight="bold" /> Done
                  </span>
                )
              }
              actions={
                <>
                  {torrent.status === "seeding" && (
                    <CardAction icon={Stop} label="Stop seeding" onClick={() => { pauseTorrent(torrent.id); fetchAll(); }} />
                  )}
                  <CardAction icon={Trash} label="Remove" destructive onClick={() => { removeTorrent(torrent.id); fetchAll(); }} />
                </>
              }
            >
              <p className="text-[11px] text-muted-foreground">
                {torrent.status === "seeding" && (
                  <span className="text-green-600 dark:text-green-400">&uarr; {formatSpeed(torrent.uploadSpeed)} &middot; </span>
                )}
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
          isEmpty={enabledAutomations.length === 0}
          emptyContent={
            <EmptyRowCard
              icon={Lightning}
              label="Create an automation"
              hint="Run an agent when something happens"
              onClick={() => setShowAddAutomation(true)}
            />
          }
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
          {enabledAutomations.map((rule) => {
            const onRun = async () => {
              setRunningAutoId(rule.id);
              try { await triggerAutomation(rule.id); await fetchAll(); }
              catch {}
              setRunningAutoId(null);
            };
            const onEdit = () => {
              setEditAutoId(rule.id);
              setEditAutoForm({
                name: rule.name,
                triggerType: rule.triggerType,
                cron: (rule.triggerConfig as { cron?: string })?.cron || "",
                prompt: rule.prompt,
              });
              setEditAutoLogs([]);
              setEditAutoLastResponse(null);
              getAutomation(rule.id)
                .then((res) => {
                  setEditAutoLogs(res.logs || []);
                  setEditAutoLastResponse(res.lastResponse);
                })
                .catch(() => {});
            };
            const onDelete = async () => {
              if (!confirm(`Delete "${rule.name}"?`)) return;
              await deleteAutomation(rule.id);
              await fetchAll();
            };
            return (
              <div
                key={rule.id}
                role="button"
                tabIndex={0}
                onClick={onEdit}
                onKeyDown={(e) => { if (e.key === "Enter") onEdit(); }}
                className="w-56 rounded-xl shadow-sm border bg-card p-4 flex flex-col text-left hover:bg-accent/50 transition-colors group cursor-pointer relative overflow-hidden"
              >
                <p className="text-sm font-medium leading-tight line-clamp-1 group-hover:text-foreground">{rule.name}</p>
                <div className="mt-2">
                  <span className="text-[10px] bg-automation/15 text-automation px-1.5 py-0.5 rounded-full">
                    {rule.triggerType.replace(":", " ")}
                  </span>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground line-clamp-3 flex-1">
                  {rule.prompt}
                </p>
                <p className="mt-2 text-[10px] text-muted-foreground">
                  Triggered {rule.triggerCount} time{rule.triggerCount !== 1 ? "s" : ""}
                </p>
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-end p-2 gap-1.5">
                  <CardAction
                    icon={Play}
                    label={runningAutoId === rule.id ? "Running…" : "Run now"}
                    onClick={onRun}
                  />
                  <CardAction
                    icon={Trash}
                    label="Delete"
                    destructive
                    onClick={onDelete}
                  />
                </div>
              </div>
            );
          })}
        </ContentRow>
      )}

      {/* Add to Watchlist Modal */}
      {showAddWatchlist && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onClick={() => setShowAddWatchlist(false)}>
          <div className="bg-card rounded-xl shadow-lg border p-6 w-full max-w-sm space-y-4 animate-card-enter" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold">Add to Watchlist</h3>
            <input
              placeholder="Title"
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
                <option value="schedule">On a schedule</option>
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

      {/* Edit Automation Modal */}
      {editAutoId && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onClick={() => setEditAutoId(null)}>
          <div className="bg-card rounded-xl shadow-lg border p-6 w-full max-w-md space-y-4 animate-card-enter" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold">Edit Automation</h3>
            <input
              placeholder="Rule name"
              value={editAutoForm.name}
              onChange={(e) => setEditAutoForm({ ...editAutoForm, name: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded-lg border bg-background"
              autoFocus
            />
            <div>
              <label className="text-xs text-muted-foreground">Trigger</label>
              <select
                value={editAutoForm.triggerType}
                onChange={(e) => setEditAutoForm({ ...editAutoForm, triggerType: e.target.value })}
                className="w-full px-3 py-2 text-sm rounded-lg border bg-background mt-1"
              >
                <option value="torrent:completed">Torrent completes</option>
                <option value="torrent:added">Torrent added</option>
                <option value="torrent:error">Torrent error</option>
                <option value="torrent:stalled">Torrent stalled</option>
                <option value="watchlist:match">Watchlist match found</option>
                <option value="schedule">On a schedule</option>
              </select>
            </div>
            {editAutoForm.triggerType === "schedule" && (
              <div>
                <label className="text-xs text-muted-foreground">Cron expression</label>
                <input
                  placeholder="0 9 * * 1   (e.g. Mondays at 9am)"
                  value={editAutoForm.cron}
                  onChange={(e) => setEditAutoForm({ ...editAutoForm, cron: e.target.value })}
                  className="w-full px-3 py-2 text-sm rounded-lg border bg-background mt-1 font-mono"
                />
              </div>
            )}
            <div>
              <label className="text-xs text-muted-foreground">Prompt</label>
              <textarea
                placeholder="What should happen when this fires"
                value={editAutoForm.prompt}
                onChange={(e) => setEditAutoForm({ ...editAutoForm, prompt: e.target.value })}
                rows={5}
                className="w-full px-3 py-2 text-sm rounded-lg border bg-background mt-1 resize-y"
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={async () => {
                  if (!editAutoId || !editAutoForm.name.trim()) return;
                  const patch: Parameters<typeof updateAutomation>[1] = {
                    name: editAutoForm.name.trim(),
                    prompt: editAutoForm.prompt.trim(),
                    triggerType: editAutoForm.triggerType,
                  };
                  if (editAutoForm.triggerType === "schedule") {
                    patch.triggerConfig = editAutoForm.cron.trim() ? { cron: editAutoForm.cron.trim() } : {};
                  } else {
                    patch.triggerConfig = {};
                  }
                  await updateAutomation(editAutoId, patch);
                  setEditAutoId(null);
                  fetchAll();
                }}
                disabled={!editAutoForm.name.trim()}
                className="flex-1 px-4 py-2 text-sm bg-automation text-automation-foreground rounded-lg hover:opacity-90 disabled:opacity-50"
              >
                Save
              </button>
              <button
                onClick={() => setEditAutoId(null)}
                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted"
              >
                Cancel
              </button>
            </div>

            {/* History — last response + trigger log */}
            <div className="pt-3 border-t space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Last response</label>
                {editAutoLastResponse ? (
                  <div className="mt-1.5 rounded-md border bg-muted/30 px-3 py-2 max-h-40 overflow-y-auto">
                    <p className="text-[10px] text-muted-foreground">
                      {formatRelativeTime(editAutoLastResponse.ts)}
                    </p>
                    <p className="mt-1 text-xs whitespace-pre-wrap leading-relaxed">
                      {editAutoLastResponse.text}
                    </p>
                  </div>
                ) : (
                  <p className="mt-1.5 text-xs text-muted-foreground italic">No responses yet.</p>
                )}
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Recent triggers ({editAutoLogs.length})
                </label>
                {editAutoLogs.length === 0 ? (
                  <p className="mt-1.5 text-xs text-muted-foreground italic">Never triggered.</p>
                ) : (
                  <ul className="mt-1.5 space-y-1 max-h-32 overflow-y-auto">
                    {editAutoLogs.slice(0, 10).map((log) => (
                      <li key={log.id} className="flex items-center justify-between gap-2 text-[11px]">
                        <span className={log.conditionsMet ? "text-foreground" : "text-destructive"}>
                          {log.triggerEvent}{log.errorMessage ? ` — ${log.errorMessage}` : ""}
                        </span>
                        <span className="text-muted-foreground tabular-nums shrink-0">
                          {formatRelativeTime(log.executedAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
