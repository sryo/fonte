"use client";

// Dashboard home page: filterable rows of torrents, watchlist, and automations.

import { useState, useEffect, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  getTorrents,
  getWatchlist,
  getAutomations,
  getIndexerStatus,
  removeTorrent,
  deleteWatchlistEntry,
  updateAutomation,
  getAutomation,
  triggerAutomation,
  deleteAutomation,
  triggerWatchlistSearch,
  type AutomationLog,
} from "@/lib/api";
import type {
  TorrentRecord,
  WatchlistRecord,
  AutomationRule,
  IndexerStatus,
} from "@/lib/api";
import {
  DownloadSimple,
  Eye,
  Lightning,
  Check,
  Plus,
  Trash,
} from "@phosphor-icons/react";
import { usePolling } from "@/hooks/usePolling";
import { usePoofRemoval } from "@/hooks/use-poof-removal";
import { useStallDetection } from "@/hooks/use-stall-detection";
import { EmptyRowCard } from "@/components/home/empty-row-card";
import { AddTorrentCard } from "@/components/home/add-torrent-card";
import { ContentRow } from "@/components/home/content-row";
import { TorrentCard } from "@/components/home/torrent-card";
import { WatchlistCard } from "@/components/home/watchlist-card";
import { CompletedCard } from "@/components/home/completed-card";
import { AutomationCard } from "@/components/home/automation-card";
import { IndexerBanner } from "@/components/home/indexer-banner";
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
  const [filter, setFilter] = useState<FilterChip>("all");

  const [torrents, setTorrents] = useState<TorrentRecord[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistRecord[]>([]);
  const [automations, setAutomations] = useState<AutomationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [indexerStatus, setIndexerStatus] = useState<IndexerStatus | null>(null);
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
  const [editAutoLogs, setEditAutoLogs] = useState<AutomationLog[]>([]);
  const [editAutoLastResponse, setEditAutoLastResponse] = useState<{ text: string; ts: number } | null>(null);

  const { recordProgress, isStalled } = useStallDetection();

  // usePoofRemoval needs to trigger refetches and fetchAll needs filterHidden;
  // the ref breaks the cycle.
  const fetchAllRef = useRef<() => void>(() => {});
  const { exitingIds, poofThenRemove, filterHidden } = usePoofRemoval(() => fetchAllRef.current());

  const fetchAll = useCallback(async () => {
    try {
      const [torrentsRes, watchlistRes, automationsRes] = await Promise.all([
        getTorrents(),
        getWatchlist(),
        getAutomations(),
      ]);
      recordProgress(torrentsRes.torrents);
      setTorrents(filterHidden(torrentsRes.torrents));
      setWatchlist(filterHidden(watchlistRes.entries));
      setAutomations(automationsRes.rules);
    } catch {
      /* silently ignore */
    } finally {
      setLoading(false);
    }
  }, [recordProgress, filterHidden]);
  fetchAllRef.current = fetchAll;

  usePolling(fetchAll, 3000);

  // Indexer status is a real Jackett search on every call; check once on
  // mount instead of every poll tick.
  useEffect(() => {
    getIndexerStatus().then(setIndexerStatus).catch(() => {});
  }, []);

  const searchWatchlistEntry = async (id: string) => {
    setSearchingWlIds((prev) => { const next = new Set(prev); next.add(id); return next; });
    try { await triggerWatchlistSearch(id); }
    catch { /* ignore */ }
    setSearchingWlIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
    fetchAll();
  };

  const runAutomation = async (rule: AutomationRule) => {
    setRunningAutoId(rule.id);
    try { await triggerAutomation(rule.id); await fetchAll(); }
    catch {}
    setRunningAutoId(null);
  };

  const editAutomation = (rule: AutomationRule) => {
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

  const deleteAutomationRule = async (rule: AutomationRule) => {
    await deleteAutomation(rule.id);
    await fetchAll();
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
      <IndexerBanner status={indexerStatus} />

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
          emptyContent={<AddTorrentCard onAdded={fetchAll} />}
          action={
            activeTorrents.length > 0 ? <AddTorrentCard variant="action" onAdded={fetchAll} /> : undefined
          }
        >
          {activeTorrents.map((torrent) => (
            <TorrentCard
              key={torrent.id}
              torrent={torrent}
              exiting={exitingIds.has(torrent.id)}
              exitDelay={exitingIds.get(torrent.id)}
              stalled={isStalled(torrent)}
              onRefresh={fetchAll}
              onPoofRemove={() => poofThenRemove([torrent.id], removeTorrent)}
            />
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
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors rounded-md px-2.5 py-1.5 hover:bg-muted"
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </button>
          }
        >
          {watchingEntries.map((entry) => (
            <WatchlistCard
              key={entry.id}
              entry={entry}
              exiting={exitingIds.has(entry.id)}
              exitDelay={exitingIds.get(entry.id)}
              searching={searchingWlIds.has(entry.id)}
              onSearch={() => searchWatchlistEntry(entry.id)}
              onPoofRemove={() => poofThenRemove([entry.id], deleteWatchlistEntry)}
            />
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
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive transition-colors rounded-md px-2.5 py-1.5 hover:bg-muted"
            >
              <Trash className="h-3.5 w-3.5" />
              Clear
            </button>
          ) : undefined}
        >
          {completedTorrents.map((torrent) => (
            <CompletedCard
              key={torrent.id}
              torrent={torrent}
              exiting={exitingIds.has(torrent.id)}
              exitDelay={exitingIds.get(torrent.id)}
              onRefresh={fetchAll}
              onPoofRemove={() => poofThenRemove([torrent.id], removeTorrent)}
            />
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
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors rounded-md px-2.5 py-1.5 hover:bg-muted"
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </button>
          }
        >
          {enabledAutomations.map((rule) => (
            <AutomationCard
              key={rule.id}
              rule={rule}
              running={runningAutoId === rule.id}
              onRun={() => runAutomation(rule)}
              onEdit={() => editAutomation(rule)}
              onDelete={() => deleteAutomationRule(rule)}
            />
          ))}
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
