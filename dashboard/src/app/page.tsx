"use client";

// Dashboard home page: filterable rows of torrents, watchlist, and automations.

import { useState, useEffect, useCallback, useRef } from "react";
import {
  getTorrents,
  getWatchlist,
  getAutomations,
  getIndexerStatus,
  removeTorrent,
  deleteWatchlistEntry,
  triggerAutomation,
  deleteAutomation,
  triggerWatchlistSearch,
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
  Plus,
  Trash,
} from "@phosphor-icons/react";
import { usePollingEffect } from "@/lib/hooks";
import { usePoofRemoval } from "@/hooks/use-poof-removal";
import { usePersistedState } from "@/hooks/use-persisted-state";
import {
  countTorrentPills,
  isFinished,
  sortTorrents,
  DEFAULT_VISIBLE_PILLS,
  SORT_OPTIONS,
  TORRENT_PILL_PREDICATES,
  type PillKey,
  type SortKey,
  type TorrentPillKey,
} from "@/lib/torrent-order";
import { PillBar } from "@/components/home/pill-bar";
import { SortDropdown } from "@/components/shared/sort-dropdown";
import { EmptyRowCard } from "@/components/home/empty-row-card";
import { AddTorrentCard } from "@/components/home/add-torrent-card";
import { ContentRow } from "@/components/home/content-row";
import { TorrentCard } from "@/components/home/torrent-card";
import { WatchlistCard } from "@/components/home/watchlist-card";
import { FulfilledTray } from "@/components/home/fulfilled-tray";
import { CompletedCard } from "@/components/home/completed-card";
import { AutomationCard } from "@/components/home/automation-card";
import { IndexerBanner } from "@/components/home/indexer-banner";
import { AddWatchlistModal } from "@/components/home/add-watchlist-modal";
import { AddAutomationModal } from "@/components/home/add-automation-modal";
import { EditAutomationModal } from "@/components/home/edit-automation-modal";

// ── Main Page ────────────────────────────────────────────────────────────

export default function HomePage() {
  const [pill, setPill] = useState<PillKey>("all");
  const [sort, setSort] = usePersistedState<SortKey>(
    "fonte.home-sort",
    "status",
    (v): v is SortKey => typeof v === "string" && SORT_OPTIONS.some((o) => o.key === v)
  );
  const [visiblePills, setVisiblePills] = usePersistedState<PillKey[]>(
    "fonte.home-filter-pills",
    DEFAULT_VISIBLE_PILLS,
    (v): v is PillKey[] => Array.isArray(v) && v.every((k) => typeof k === "string")
  );

  const [torrents, setTorrents] = useState<TorrentRecord[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistRecord[]>([]);
  const [automations, setAutomations] = useState<AutomationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [indexerStatus, setIndexerStatus] = useState<IndexerStatus | null>(null);
  const [showAddWatchlist, setShowAddWatchlist] = useState(false);
  const [showAddAutomation, setShowAddAutomation] = useState(false);
  const [editAutoRule, setEditAutoRule] = useState<AutomationRule | null>(null);
  const [runningAutoId, setRunningAutoId] = useState<string | null>(null);
  const [searchingWlIds, setSearchingWlIds] = useState<Set<string>>(new Set());

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
      setTorrents(filterHidden(torrentsRes.torrents));
      setWatchlist(filterHidden(watchlistRes.entries));
      setAutomations(automationsRes.rules);
    } catch {
      /* silently ignore */
    } finally {
      setLoading(false);
    }
  }, [filterHidden]);
  fetchAllRef.current = fetchAll;

  usePollingEffect(fetchAll, 3000);

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

  const deleteAutomationRule = async (rule: AutomationRule) => {
    await deleteAutomation(rule.id);
    await fetchAll();
  };

  // ── Derived data ───────────────────────────────────────────────────────

  const lane = torrents.filter((t) => t.status !== "removed");
  // Every entry stays reachable from home; fulfilled ones pile into the tray.
  const watchlistStatusRank = { watching: 0, paused: 1, fulfilled: 2 } as const;
  const activeEntries = watchlist
    .filter((w) => w.status !== "fulfilled")
    .sort((a, b) => watchlistStatusRank[a.status] - watchlistStatusRank[b.status]);
  const fulfilledEntries = watchlist
    .filter((w) => w.status === "fulfilled")
    .sort((a, b) => (b.lastMatchAt ?? b.updatedAt) - (a.lastMatchAt ?? a.updatedAt));
  const enabledAutomations = automations.filter((a) => a.enabled);

  const counts: Record<PillKey, number> = {
    ...countTorrentPills(lane),
    all: lane.length,
    watching: watchlist.length,
  };

  const pillPredicate = pill in TORRENT_PILL_PREDICATES
    ? TORRENT_PILL_PREDICATES[pill as TorrentPillKey]
    : null;
  const shownTorrents = sortTorrents(pillPredicate ? lane.filter(pillPredicate) : lane, sort);
  // "Finished" in the user's sense: done downloading, whether still seeding
  // or stopped. Scoped to the visible cards so Clear never poofs torrents
  // hidden by the active pill.
  const finishedClearable = shownTorrents.filter(isFinished);

  // A pill you can't see or that has drained falls back to All — one rule
  // covering both the last-error-resolved case and unchecking the pill
  // you're currently on in the "+" configurator.
  const pillAvailable = (key: PillKey) =>
    key === "all" || (counts[key] > 0 && (key === "issues" || visiblePills.includes(key)));
  useEffect(() => {
    if (pill !== "all" && !pillAvailable(pill)) {
      setPill("all");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pill, counts.active, counts.seeding, counts.paused, counts.finished, counts.issues, counts.watching, visiblePills]);

  // ── Visibility based on filter ─────────────────────────────────────────

  const showDownloads = pill !== "watching";
  const showWatching = pill === "all" || pill === "watching";
  const showAutomations = pill === "all";
  const showPillRow = lane.length > 0 || watchlist.length > 0;

  // ── Render ─────────────────────────────────────────────────────────────

  const renderWatchlistCard = (entry: WatchlistRecord) => (
    <WatchlistCard
      key={entry.id}
      entry={entry}
      exiting={exitingIds.has(entry.id)}
      exitDelay={exitingIds.get(entry.id)}
      searching={searchingWlIds.has(entry.id)}
      onSearch={() => searchWatchlistEntry(entry.id)}
      onPoofRemove={() => poofThenRemove([entry.id], deleteWatchlistEntry)}
    />
  );

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

      {/* Filter pills — hidden on a fresh install where the add-card carries the page */}
      {showPillRow && (
        <PillBar
          counts={counts}
          active={pill}
          onSelect={setPill}
          visible={visiblePills}
          onVisibleChange={setVisiblePills}
        />
      )}

      {/* One lane for every non-removed torrent */}
      {showDownloads && (
        <ContentRow
          title="Downloads"
          count={shownTorrents.length}
          icon={DownloadSimple}
          isEmpty={lane.length === 0}
          emptyContent={<AddTorrentCard onAdded={fetchAll} />}
          action={
            <div className="flex items-center gap-1">
              {finishedClearable.length > 0 && (
                <button
                  onClick={() => {
                    if (!confirm(`Clear ${finishedClearable.length} finished torrent${finishedClearable.length === 1 ? "" : "s"}? Seeding stops; downloaded files stay on disk.`)) return;
                    poofThenRemove(finishedClearable.map((t) => t.id), removeTorrent);
                  }}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive transition-colors rounded-md px-2.5 py-1.5 hover:bg-muted"
                >
                  <Trash className="h-3.5 w-3.5" />
                  Clear
                </button>
              )}
              <SortDropdown
                value={sort}
                onChange={setSort}
                options={SORT_OPTIONS}
                ariaLabel={`Sort downloads, currently ${SORT_OPTIONS.find((o) => o.key === sort)?.label ?? sort}`}
              />
              <AddTorrentCard variant="action" onAdded={fetchAll} />
            </div>
          }
        >
          {shownTorrents.map((torrent) =>
            isFinished(torrent) ? (
              <CompletedCard
                key={torrent.id}
                torrent={torrent}
                exiting={exitingIds.has(torrent.id)}
                exitDelay={exitingIds.get(torrent.id)}
                onRefresh={fetchAll}
                onPoofRemove={() => poofThenRemove([torrent.id], removeTorrent)}
              />
            ) : (
              <TorrentCard
                key={torrent.id}
                torrent={torrent}
                exiting={exitingIds.has(torrent.id)}
                exitDelay={exitingIds.get(torrent.id)}
                stalled={!!torrent.stalledSince}
                onRefresh={fetchAll}
                onPoofRemove={() => poofThenRemove([torrent.id], removeTorrent)}
              />
            )
          )}
        </ContentRow>
      )}

      {showWatching && (
        <ContentRow
          title="Watchlist"
          count={watchlist.length}
          icon={Eye}
          isEmpty={watchlist.length === 0}
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
          {activeEntries.map(renderWatchlistCard)}
          {fulfilledEntries.length > 0 && (
            <FulfilledTray
              count={fulfilledEntries.length}
              posterUrl={fulfilledEntries[0].posterUrl}
              onClear={() => poofThenRemove(fulfilledEntries.map((e) => e.id), deleteWatchlistEntry)}
            >
              {fulfilledEntries.map(renderWatchlistCard)}
            </FulfilledTray>
          )}
        </ContentRow>
      )}

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
              onEdit={() => setEditAutoRule(rule)}
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

      {editAutoRule && (
        <EditAutomationModal
          rule={editAutoRule}
          onClose={() => setEditAutoRule(null)}
          onSaved={fetchAll}
        />
      )}
    </div>
  );
}
