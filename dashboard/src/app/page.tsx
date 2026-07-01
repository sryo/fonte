"use client";

// Dashboard home page: filterable rows of torrents, watchlist, and automations.

import { useState, useEffect, useCallback, useRef } from "react";
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
import { formatBytes, formatSpeed, formatRelativeTime, formatShortRelativeTime } from "@/lib/format";
import {
  DownloadSimple,
  Eye,
  Lightning,
  Check,
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
  removeTorrent,
  deleteWatchlistEntry,
  updateAutomation,
  getAutomation,
  triggerAutomation,
  deleteAutomation,
  type AutomationLog,
  pauseTorrent,
  resumeTorrent,
  triggerWatchlistSearch,
} from "@/lib/api";
import { usePolling } from "@/hooks/usePolling";
import { CardAction } from "@/components/home/card-action";
import { ProgressRing } from "@/components/home/progress-ring";
import { MediaCard } from "@/components/home/media-card";
import { EmptyRowCard } from "@/components/home/empty-row-card";
import { StatusBadge } from "@/components/home/status-badge";
import { ContentRow } from "@/components/home/content-row";
import { AddWatchlistModal } from "@/components/home/add-watchlist-modal";
import { AddAutomationModal } from "@/components/home/add-automation-modal";
import { EditAutomationModal } from "@/components/home/edit-automation-modal";

// ── Filter types ─────────────────────────────────────────────────────────

type FilterChip = "all" | "downloading" | "completed" | "watching";

const FILTER_CHIPS: { key: FilterChip; label: string }[] = [
  { key: "all", label: "All" },
  { key: "downloading", label: "Downloading" },
  { key: "completed", label: "Completed" },
  { key: "watching", label: "Watching" },
];

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
  const [editAutoId, setEditAutoId] = useState<string | null>(null);
  const [editAutoForm, setEditAutoForm] = useState({
    name: "",
    triggerType: "torrent:completed",
    cron: "",
    prompt: "",
  });
  const [runningAutoId, setRunningAutoId] = useState<string | null>(null);
  const [searchingWlIds, setSearchingWlIds] = useState<Set<string>>(new Set());
  // id → stagger delay (ms) for cards currently playing the poof-out animation
  const [exitingIds, setExitingIds] = useState<Map<string, number>>(new Map());
  const [editAutoLogs, setEditAutoLogs] = useState<AutomationLog[]>([]);
  const [editAutoLastResponse, setEditAutoLastResponse] = useState<{ text: string; ts: number } | null>(null);

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

  // Play the staggered macOS-style poof, then delete server-side and refetch.
  // Cards stay mounted for the animation's duration so it runs before they
  // leave the DOM. Honours reduced-motion.
  const poofThenRemove = useCallback(
    (ids: string[], remove: (id: string) => Promise<unknown>) => {
      if (ids.length === 0) return;
      const reduce =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce) {
        Promise.all(ids.map((id) => remove(id))).then(() => fetchAll());
        return;
      }
      // Clamp total stagger to ~900ms so a big "Clear" never drags on.
      const stagger = ids.length > 1 ? Math.min(70, 900 / (ids.length - 1)) : 0;
      setExitingIds((prev) => {
        const next = new Map(prev);
        ids.forEach((id, i) => next.set(id, Math.round(i * stagger)));
        return next;
      });
      const maxDelay = Math.round((ids.length - 1) * stagger);
      window.setTimeout(async () => {
        await Promise.all(ids.map((id) => remove(id)));
        setExitingIds((prev) => {
          const next = new Map(prev);
          ids.forEach((id) => next.delete(id));
          return next;
        });
        fetchAll();
      }, maxDelay + 560);
    },
    [fetchAll],
  );

  const isStalled = useCallback((torrent: TorrentRecord): boolean => {
    if (torrent.status !== "downloading") return false;
    if (torrent.progress >= 1) return false;
    const entry = progressHistoryRef.current.get(torrent.id);
    if (!entry) return false;
    return Date.now() - entry.ts > STALL_MS;
  }, []);

  usePolling(fetchAll, 3000);

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

  const saveEditAutomation = async () => {
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
              posterUrl={torrent.posterUrl}
              exiting={exitingIds.has(torrent.id)}
              exitDelay={exitingIds.get(torrent.id)}
              onClick={() => router.push(`/torrents/${torrent.id}`)}
              progress={{ value: torrent.progress, stalled: isStalled(torrent) || torrent.status === "paused" }}
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
                    if (confirm(`Remove "${torrent.name}"?`)) poofThenRemove([torrent.id], removeTorrent);
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
              exiting={exitingIds.has(entry.id)}
              exitDelay={exitingIds.get(entry.id)}
              onClick={() => router.push(`/watchlist/${entry.id}`)}
              busy={searchingWlIds.has(entry.id)}
              ringColor="watchlist"
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
                    onClick={async () => {
                      setSearchingWlIds((prev) => { const next = new Set(prev); next.add(entry.id); return next; });
                      try { await triggerWatchlistSearch(entry.id); }
                      catch { /* ignore */ }
                      setSearchingWlIds((prev) => { const next = new Set(prev); next.delete(entry.id); return next; });
                      fetchAll();
                    }}
                  />
                  <CardAction icon={Trash} label="Remove" destructive onClick={() => {
                    if (confirm(`Remove "${entry.title}" from watchlist?`)) poofThenRemove([entry.id], deleteWatchlistEntry);
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
              onClick={() => poofThenRemove(completedTorrents.map((t) => t.id), removeTorrent)}
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
              posterUrl={torrent.posterUrl}
              exiting={exitingIds.has(torrent.id)}
              exitDelay={exitingIds.get(torrent.id)}
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
                  <CardAction icon={Trash} label="Remove" destructive onClick={() => poofThenRemove([torrent.id], removeTorrent)} />
                </>
              }
            >
              <p className="text-[11px] text-muted-foreground">
                {torrent.status === "seeding" && (
                  <span className="text-green-600 dark:text-green-400">&uarr; {formatSpeed(torrent.uploadSpeed)} &middot; </span>
                )}
                {formatBytes(torrent.size)}
                {torrent.completedAt && ` \u00B7 ${formatShortRelativeTime(torrent.completedAt)}`}
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
                className="w-56 rounded-xl shadow-card bg-card p-4 flex flex-col text-left hover:bg-accent/50 transition-colors group cursor-pointer relative overflow-hidden"
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
                <ProgressRing busy={runningAutoId === rule.id} color="automation" />
              </div>
            );
          })}
        </ContentRow>
      )}

      <AddWatchlistModal
        open={showAddWatchlist}
        onClose={() => setShowAddWatchlist(false)}
        onAdded={fetchAll}
      />

      <AddAutomationModal
        open={showAddAutomation}
        onClose={() => setShowAddAutomation(false)}
        onCreated={fetchAll}
      />

      {editAutoId && (
        <EditAutomationModal
          form={editAutoForm}
          setForm={setEditAutoForm}
          logs={editAutoLogs}
          lastResponse={editAutoLastResponse}
          onClose={() => setEditAutoId(null)}
          onSave={saveEditAutomation}
        />
      )}
    </div>
  );
}
