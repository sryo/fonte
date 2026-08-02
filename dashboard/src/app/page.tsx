"use client";

// Dashboard home page: filterable rows of torrents, watchlist, and automations.

import { useState, useEffect, useCallback, useRef, type CSSProperties } from "react";
import { flushSync } from "react-dom";
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
import { RemoveTorrentDialog } from "@/components/torrent/remove-torrent-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CardSizeProvider, CARD_SIZE_COMPACT_BELOW, CARD_SIZE_MIN, CARD_SIZE_MAX } from "@/components/home/card-resize";
import {
  AddMiniTile,
  AutomationMiniTile,
  TorrentMiniTile,
  TrayMiniTile,
  WatchlistMiniTile,
  vtName,
} from "@/components/home/mini-tile";

type SectionKey = "downloads" | "watchlist" | "automations";
const SECTION_KEYS: readonly string[] = ["downloads", "watchlist", "automations"];

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
  const [cardSize, setCardSize] = usePersistedState<number>(
    "fonte.card-size",
    176,
    (v): v is number => typeof v === "number" && v >= CARD_SIZE_MIN && v <= CARD_SIZE_MAX
  );
  const [collapsedSections, setCollapsedSections] = usePersistedState<SectionKey[]>(
    "fonte.home-collapsed-sections",
    [],
    (v): v is SectionKey[] =>
      Array.isArray(v) && v.every((k) => typeof k === "string" && SECTION_KEYS.includes(k))
  );

  const isCollapsed = (key: SectionKey) => collapsedSections.includes(key);
  // Morph the card↔tile swap when the browser can; plain swap otherwise.
  const withMorph = (update: () => void) => {
    if (document.startViewTransition && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      document.startViewTransition(() => {
        flushSync(update);
      });
    } else {
      update();
    }
  };
  const toggleSection = (key: SectionKey) =>
    withMorph(() =>
      setCollapsedSections((prev) =>
        prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
      )
    );
  const expandSection = (key: SectionKey) =>
    withMorph(() => setCollapsedSections((prev) => prev.filter((k) => k !== key)));

  const [torrents, setTorrents] = useState<TorrentRecord[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistRecord[]>([]);
  const [automations, setAutomations] = useState<AutomationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [indexerStatus, setIndexerStatus] = useState<IndexerStatus | null>(null);
  const [showAddWatchlist, setShowAddWatchlist] = useState(false);
  const [showAddAutomation, setShowAddAutomation] = useState(false);
  const [editAutoRule, setEditAutoRule] = useState<AutomationRule | null>(null);
  const [removeTarget, setRemoveTarget] = useState<TorrentRecord | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
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
      // keep the last good data
    } finally {
      setLoading(false);
    }
  }, [filterHidden]);
  fetchAllRef.current = fetchAll;

  usePollingEffect(fetchAll, 3000);

  // Indexer status is a real Jackett search, so it polls on a slow cadence
  // (not the 3s torrent poll) — enough to self-heal the banner when Jackett
  // comes back without a page reload. Exposed as a callback so the banner can
  // also re-check immediately after restarting Jackett.
  const refreshIndexerStatus = useCallback(() => {
    getIndexerStatus().then(setIndexerStatus).catch(() => {});
  }, []);
  useEffect(() => {
    refreshIndexerStatus();
    const t = setInterval(refreshIndexerStatus, 30000);
    return () => clearInterval(t);
  }, [refreshIndexerStatus]);

  const searchWatchlistEntry = async (id: string) => {
    setSearchingWlIds((prev) => { const next = new Set(prev); next.add(id); return next; });
    try { await triggerWatchlistSearch(id); }
    catch {}
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

  const showDownloads = pill !== "watching";
  const showWatching = pill === "all" || pill === "watching";
  const showAutomations = pill === "all";
  const showPillRow = lane.length > 0 || watchlist.length > 0;

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
    <CardSizeProvider size={cardSize} setSize={setCardSize}>
    <div
      className="max-w-(--content-max-w) mx-auto px-6 py-6 space-y-8 animate-card-enter group/cards"
      style={{ "--card-w": `${cardSize}px` } as CSSProperties}
      data-cards-root=""
      data-cards={cardSize < CARD_SIZE_COMPACT_BELOW ? "compact" : undefined}
    >
      <IndexerBanner status={indexerStatus} onRestarted={refreshIndexerStatus} />

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

      {showDownloads && (
        <ContentRow
          title="Downloads"
          count={shownTorrents.length}
          icon={DownloadSimple}
          isEmpty={lane.length === 0}
          emptyContent={
            <div className="flex" style={{ viewTransitionName: "hi-add-dl" }}>
              <AddTorrentCard onAdded={fetchAll} />
            </div>
          }
          collapsed={isCollapsed("downloads")}
          onToggleCollapse={() => toggleSection("downloads")}
          transitionName="hs-downloads"
          collapsedContent={
            lane.length === 0 ? (
              <AddMiniTile
                label="Add a torrent"
                onClick={() => expandSection("downloads")}
                transitionName="hi-add-dl"
              />
            ) : (
              shownTorrents.map((torrent) => (
                <TorrentMiniTile
                  key={torrent.id}
                  torrent={torrent}
                  exiting={exitingIds.has(torrent.id)}
                  exitDelay={exitingIds.get(torrent.id)}
                />
              ))
            )
          }
          action={
            <div className="flex items-center gap-1">
              {finishedClearable.length > 0 && (
                <button
                  onClick={() => setClearOpen(true)}
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
          {shownTorrents.map((torrent) => (
            <div
              key={torrent.id}
              className="flex"
              style={{ viewTransitionName: vtName("t", torrent.id) }}
            >
              {isFinished(torrent) ? (
                <CompletedCard
                  torrent={torrent}
                  exiting={exitingIds.has(torrent.id)}
                  exitDelay={exitingIds.get(torrent.id)}
                  onRefresh={fetchAll}
                  onRemoveRequest={() => setRemoveTarget(torrent)}
                />
              ) : (
                <TorrentCard
                  torrent={torrent}
                  exiting={exitingIds.has(torrent.id)}
                  exitDelay={exitingIds.get(torrent.id)}
                  stalled={!!torrent.stalledSince}
                  onRefresh={fetchAll}
                  onRemoveRequest={() => setRemoveTarget(torrent)}
                />
              )}
            </div>
          ))}
        </ContentRow>
      )}

      {showWatching && (
        <ContentRow
          title="Watchlist"
          count={watchlist.length}
          icon={Eye}
          isEmpty={watchlist.length === 0}
          emptyContent={
            <div className="flex" style={{ viewTransitionName: "hi-add-wl" }}>
              <EmptyRowCard
                icon={Eye}
                label="Watch for a release"
                hint="We'll grab it when it shows up"
                onClick={() => setShowAddWatchlist(true)}
              />
            </div>
          }
          collapsed={isCollapsed("watchlist")}
          onToggleCollapse={() => toggleSection("watchlist")}
          transitionName="hs-watchlist"
          collapsedContent={
            watchlist.length === 0 ? (
              <AddMiniTile
                label="Watch for a release"
                onClick={() => setShowAddWatchlist(true)}
                transitionName="hi-add-wl"
              />
            ) : (
              <>
                {activeEntries.map((entry) => (
                  <WatchlistMiniTile
                    key={entry.id}
                    entry={entry}
                    searching={searchingWlIds.has(entry.id)}
                    exiting={exitingIds.has(entry.id)}
                    exitDelay={exitingIds.get(entry.id)}
                  />
                ))}
                {fulfilledEntries.length > 0 && (
                  <TrayMiniTile
                    count={fulfilledEntries.length}
                    onExpand={() => expandSection("watchlist")}
                  />
                )}
              </>
            )
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
          {activeEntries.map((entry) => (
            <div
              key={entry.id}
              className="flex"
              style={{ viewTransitionName: vtName("w", entry.id) }}
            >
              {renderWatchlistCard(entry)}
            </div>
          ))}
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
            <div className="flex" style={{ viewTransitionName: "hi-add-auto" }}>
              <EmptyRowCard
                icon={Lightning}
                label="Create an automation"
                hint="Run an agent when something happens"
                onClick={() => setShowAddAutomation(true)}
              />
            </div>
          }
          collapsed={isCollapsed("automations")}
          onToggleCollapse={() => toggleSection("automations")}
          transitionName="hs-automations"
          collapsedContent={
            enabledAutomations.length === 0 ? (
              <AddMiniTile
                label="Create an automation"
                onClick={() => setShowAddAutomation(true)}
                transitionName="hi-add-auto"
              />
            ) : (
              enabledAutomations.map((rule) => (
                <AutomationMiniTile
                  key={rule.id}
                  rule={rule}
                  running={runningAutoId === rule.id}
                  onClick={() => setEditAutoRule(rule)}
                />
              ))
            )
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
            <div key={rule.id} className="flex" style={{ viewTransitionName: vtName("a", rule.id) }}>
              <AutomationCard
                rule={rule}
                running={runningAutoId === rule.id}
                onRun={() => runAutomation(rule)}
                onEdit={() => setEditAutoRule(rule)}
                onDelete={() => deleteAutomationRule(rule)}
              />
            </div>
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

      <RemoveTorrentDialog
        open={removeTarget !== null}
        torrentName={removeTarget?.name}
        onClose={() => setRemoveTarget(null)}
        onConfirm={(deleteFiles) => {
          const target = removeTarget;
          if (target) poofThenRemove([target.id], (id) => removeTorrent(id, deleteFiles));
        }}
      />

      <ConfirmDialog
        open={clearOpen}
        title="Clear finished"
        message={<>Clear {finishedClearable.length} finished torrent{finishedClearable.length === 1 ? "" : "s"}? Seeding stops; downloaded files stay on disk.</>}
        confirmLabel="Clear"
        destructive
        onConfirm={() => poofThenRemove(finishedClearable.map((t) => t.id), removeTorrent)}
        onClose={() => setClearOpen(false)}
      />
    </div>
    </CardSizeProvider>
  );
}
