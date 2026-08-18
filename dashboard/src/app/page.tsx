"use client";

// Dashboard home page: filterable rows of torrents, watchlist, and automations.

import { useState, useEffect, useCallback, useRef, type CSSProperties } from "react";
import { flushSync } from "react-dom";
import {
  getTorrents,
  getWatchlist,
  getAutomations,
  getIndexerStatus,
  moveTorrentInQueue,
  runWatchlistCheck,
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
  MagnifyingGlass,
  Plus,
  Trash,
} from "@phosphor-icons/react";
import { usePollingEffect } from "@/lib/hooks";
import { usePoofRemoval } from "@/hooks/use-poof-removal";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { useQueueDrag } from "@/hooks/use-queue-drag";
import {
  applyQueuePositions,
  countTorrentPills,
  isFailedAdd,
  isFinished,
  moveId,
  queueDropPosition,
  sortTorrents,
  DEFAULT_VISIBLE_PILLS,
  SORT_OPTIONS,
  TORRENT_PILL_PREDICATES,
  type PillKey,
  type SortKey,
  type TorrentPillKey,
} from "@/lib/torrent-order";
import { watchOrder } from "@/lib/watchlist-order";
import { cn } from "@/lib/utils";
import { TONE_BADGE } from "@/lib/status";
import { PillBar } from "@/components/home/pill-bar";
import { SortDropdown } from "@/components/shared/sort-dropdown";
import { EmptyRowCard } from "@/components/home/empty-row-card";
import { AddTorrentCard } from "@/components/home/add-torrent-card";
import { ContentRow } from "@/components/home/content-row";
import { TorrentCard } from "@/components/home/torrent-card";
import { WatchlistCard } from "@/components/home/watchlist-card";
import { Spinner } from "@/components/ui/feedback";
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
  WatchlistMiniTile,
  vtName,
} from "@/components/home/mini-tile";

type SectionKey = "downloads" | "watchlist" | "automations";
const SECTION_KEYS: readonly string[] = ["downloads", "watchlist", "automations"];

// Resolves once the update has actually been applied — startViewTransition
// runs its callback async, and callers like the poof flow must not proceed
// before the new state is committed.
function withMorph(update: () => void): Promise<void> {
  if (document.startViewTransition && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const transition = document.startViewTransition(() => {
      flushSync(update);
    });
    return transition.updateCallbackDone.catch(() => {});
  }
  update();
  return Promise.resolve();
}

/** Deviation-only section chip: doubles as a shortcut to the state it names. */
function HeaderChip({
  className,
  onClick,
  label,
  children,
}: {
  className: string;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums transition-opacity hover:opacity-80",
        className
      )}
    >
      {children}
    </button>
  );
}

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
  const [clearFulfilledOpen, setClearFulfilledOpen] = useState(false);
  const [searchingAll, setSearchingAll] = useState(false);
  const [runningAutoId, setRunningAutoId] = useState<string | null>(null);
  const [searchingWlIds, setSearchingWlIds] = useState<Set<string>>(new Set());

  // usePoofRemoval needs to trigger refetches and fetchAll needs filterHidden;
  // the ref breaks the cycle.
  const fetchAllRef = useRef<() => void>(() => {});
  const { exitingIds, poofThenRemove, filterHidden } = usePoofRemoval(() => fetchAllRef.current());

  // Watchlist lane order signature; a change (a search landed finds, or finds
  // were reviewed) morphs the reorder instead of snapping it.
  const watchOrderSigRef = useRef<string | null>(null);
  const fetchAll = useCallback(async () => {
    try {
      const [torrentsRes, watchlistRes, automationsRes] = await Promise.all([
        getTorrents(),
        getWatchlist(),
        getAutomations(),
      ]);
      const nextWatchlist = filterHidden(watchlistRes.entries);
      const sig = watchOrder(nextWatchlist).map((w) => w.id).join(",");
      const orderChanged = watchOrderSigRef.current !== null && watchOrderSigRef.current !== sig;
      watchOrderSigRef.current = sig;
      const apply = () => {
        setTorrents(filterHidden(torrentsRes.torrents));
        setWatchlist(nextWatchlist);
        setAutomations(automationsRes.rules);
      };
      if (orderChanged) await withMorph(apply);
      else apply();
    } catch {
      // keep the last good data
    } finally {
      setLoading(false);
    }
  }, [filterHidden]);
  fetchAllRef.current = fetchAll;

  // Held true from queue-drag pickup until the commit settles, so a poll
  // can't rewrite the row mid-drag.
  const queuePollPausedRef = useRef(false);

  // Promotion feedback at the card itself: a transient position badge that
  // dissolves after a beat, plus a one-shot scale tick on the wrapper.
  const [queueFlash, setQueueFlash] = useState<Map<string, { pos: number; leaving: boolean }>>(
    new Map()
  );
  const flashTimers = useRef(new Map<string, number[]>());
  useEffect(() => {
    const timers = flashTimers.current;
    return () => timers.forEach((ids) => ids.forEach((t) => window.clearTimeout(t)));
  }, []);
  const flashQueuePosition = (id: string, pos: number) => {
    flashTimers.current.get(id)?.forEach((t) => window.clearTimeout(t));
    setQueueFlash((prev) => new Map(prev).set(id, { pos, leaving: false }));
    const leave = window.setTimeout(() => {
      setQueueFlash((prev) => {
        const next = new Map(prev);
        const f = next.get(id);
        if (f) next.set(id, { ...f, leaving: true });
        return next;
      });
    }, 2200);
    const gone = window.setTimeout(() => {
      setQueueFlash((prev) => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
    }, 2400);
    flashTimers.current.set(id, [leave, gone]);
  };
  const fetchAllUnlessDragging = useCallback(() => {
    if (!queuePollPausedRef.current) fetchAll();
  }, [fetchAll]);
  usePollingEffect(fetchAllUnlessDragging, 3000);

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

  const searchAllWatchlist = async () => {
    if (searchingAll) return;
    setSearchingAll(true);
    const watchingIds = watchlist.filter((w) => w.status === "watching").map((w) => w.id);
    setSearchingWlIds((prev) => new Set([...prev, ...watchingIds]));
    try { await runWatchlistCheck(); }
    catch {}
    setSearchingWlIds((prev) => {
      const next = new Set(prev);
      watchingIds.forEach((id) => next.delete(id));
      return next;
    });
    setSearchingAll(false);
    fetchAll();
  };

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
  const activeEntries = watchOrder(watchlist);
  const foundCount = activeEntries.filter((w) => (w.newResultsCount ?? 0) > 0).length;
  const fulfilledEntries = watchlist.filter((w) => w.status === "fulfilled");
  const enabledAutomations = automations.filter((a) => a.enabled);

  const counts: Record<PillKey, number> = {
    ...countTorrentPills(lane),
    all: lane.length,
    watching: watchlist.length,
  };

  const pillPredicate = pill in TORRENT_PILL_PREDICATES
    ? TORRENT_PILL_PREDICATES[pill as TorrentPillKey]
    : null;
  const filteredLane = pillPredicate ? lane.filter(pillPredicate) : lane;
  const shownTorrents = sortTorrents(filteredLane, sort);
  const queueOrderIds = sortTorrents(filteredLane, "queue").map((t) => t.id);

  const queueDrag = useQueueDrag({
    visibleIds: shownTorrents.map((t) => t.id),
    queueIds: queueOrderIds,
    canDrag: (id) => !exitingIds.has(id),
    withMorph,
    pollPausedRef: queuePollPausedRef,
    onCommit: (id, index, orderedIds) => commitQueueMove(id, index, orderedIds),
  });

  function commitQueueMove(id: string, index: number, orderedIds: string[]) {
    const target = queueDropPosition(new Map(lane.map((t) => [t.id, t])), orderedIds, index);
    // Optimistic positions land in the same update that drops the drag
    // override, so the row can't flash back to the pre-drag order.
    const settle = () => {
      setTorrents((prev) => applyQueuePositions(prev, orderedIds));
      queueDrag.clearOrder();
    };
    if (sort !== "queue") withMorph(settle);
    else settle();
    flashQueuePosition(id, index);
    moveTorrentInQueue(id, target)
      .catch(() => {})
      .finally(() => {
        queuePollPausedRef.current = false;
        fetchAll();
      });
  }

  const nudgeQueue = (id: string, move: "up" | "down" | "top" | "bottom") => {
    const from = queueOrderIds.indexOf(id);
    if (from === -1) return;
    const to =
      move === "up" ? Math.max(0, from - 1)
      : move === "down" ? Math.min(queueOrderIds.length - 1, from + 1)
      : move === "top" ? 0
      : queueOrderIds.length - 1;
    if (to === from) return;
    const next = moveId(queueOrderIds, from, to);
    withMorph(() => setTorrents((prev) => applyQueuePositions(prev, next)));
    flashQueuePosition(id, to);
    moveTorrentInQueue(id, move).catch(() => {}).finally(() => fetchAll());
  };

  const laneById = new Map(lane.map((t) => [t.id, t]));
  const displayTorrents = queueDrag.order
    ? queueDrag.order
        .map((id) => laneById.get(id))
        .filter((t): t is TorrentRecord => t !== undefined)
    : shownTorrents;
  // Clear covers done torrents (still seeding or stopped) plus adds that
  // failed before fetching anything — other issues keep needing a deliberate
  // remove. Scoped to the visible cards so Clear never poofs torrents hidden
  // by the active pill.
  const clearable = shownTorrents.filter((t) => isFinished(t) || isFailedAdd(t));
  const clearFinishedCount = clearable.filter(isFinished).length;
  const clearFailedCount = clearable.length - clearFinishedCount;

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
      data-queue-drag-active={queueDrag.draggingId != null ? "" : undefined}
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
          chips={
            counts.issues > 0 && (
              <HeaderChip
                className={TONE_BADGE.warn}
                label={`Filter to ${counts.issues} torrents with issues`}
                onClick={() => setPill("issues")}
              >
                {counts.issues} issue{counts.issues === 1 ? "" : "s"}
              </HeaderChip>
            )
          }
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
              displayTorrents.map((torrent) => (
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
              {clearable.length > 0 && (
                <button
                  onClick={() => setClearOpen(true)}
                  className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-extrabold text-foreground transition-colors hover:bg-muted hover:text-destructive"
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
          {displayTorrents.map((torrent) => (
            <div
              key={torrent.id}
              ref={queueDrag.registerWrapper(torrent.id)}
              data-queue-wrapper=""
              onPointerDown={queueDrag.onPointerDown(torrent.id)}
              className={cn(
                "flex",
                queueDrag.draggingId === torrent.id && "queue-drag-lift",
                queueFlash.has(torrent.id) && "queue-flash-pulse"
              )}
              style={{ viewTransitionName: vtName("t", torrent.id) }}
            >
              {isFinished(torrent) ? (
                <CompletedCard
                  torrent={torrent}
                  exiting={exitingIds.has(torrent.id)}
                  exitDelay={exitingIds.get(torrent.id)}
                  onRefresh={fetchAll}
                  onRemoveRequest={() => setRemoveTarget(torrent)}
                  onQueueMove={(move) => nudgeQueue(torrent.id, move)}
                  queueFlash={queueFlash.get(torrent.id)}
                />
              ) : (
                <TorrentCard
                  torrent={torrent}
                  exiting={exitingIds.has(torrent.id)}
                  exitDelay={exitingIds.get(torrent.id)}
                  stalled={!!torrent.stalledSince}
                  onRefresh={fetchAll}
                  onRemoveRequest={() => setRemoveTarget(torrent)}
                  onQueueMove={(move) => nudgeQueue(torrent.id, move)}
                  queueFlash={queueFlash.get(torrent.id)}
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
          chips={
            foundCount > 0 && (
              <HeaderChip
                className={TONE_BADGE.watch}
                label={`${foundCount} entries with unreviewed results`}
                onClick={() => expandSection("watchlist")}
              >
                {foundCount} new
              </HeaderChip>
            )
          }
          isEmpty={watchlist.length === 0}
          emptyContent={
            <div className="flex" style={{ viewTransitionName: "hi-add-wl" }}>
              <EmptyRowCard
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
              </>
            )
          }
          action={
            <div className="flex items-center gap-1">
              {fulfilledEntries.length > 0 && (
                <button
                  onClick={() => setClearFulfilledOpen(true)}
                  className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-extrabold text-foreground transition-colors hover:bg-muted hover:text-destructive"
                >
                  <Trash className="h-3.5 w-3.5" />
                  Clear
                </button>
              )}
              <button
                onClick={searchAllWatchlist}
                disabled={searchingAll}
                className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-extrabold text-foreground transition-colors hover:bg-muted disabled:opacity-60"
              >
                {searchingAll ? <Spinner size="xs" /> : <MagnifyingGlass className="h-3.5 w-3.5" />}
                Search
              </button>
              <button
                onClick={() => setShowAddWatchlist(true)}
                className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-extrabold text-foreground transition-colors hover:bg-muted"
              >
                <Plus className="h-3.5 w-3.5" />
                Add
              </button>
            </div>
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
        </ContentRow>
      )}

      {showAutomations && (
        <ContentRow
          title="Automations"
          count={enabledAutomations.length}
          chips={
            runningAutoId != null && (
              <HeaderChip
                className="bg-automation/15 text-automation"
                label="An automation is running"
                onClick={() => expandSection("automations")}
              >
                1 running
              </HeaderChip>
            )
          }
          isEmpty={enabledAutomations.length === 0}
          emptyContent={
            <div className="flex" style={{ viewTransitionName: "hi-add-auto" }}>
              <EmptyRowCard
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
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-extrabold text-foreground transition-colors hover:bg-muted"
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
        open={clearFulfilledOpen}
        title="Clear fulfilled"
        message={<>Remove {fulfilledEntries.length} fulfilled item{fulfilledEntries.length === 1 ? "" : "s"} from the watchlist?</>}
        confirmLabel="Remove"
        destructive
        onConfirm={() => poofThenRemove(fulfilledEntries.map((e) => e.id), deleteWatchlistEntry)}
        onClose={() => setClearFulfilledOpen(false)}
      />

      <ConfirmDialog
        open={clearOpen}
        title={clearFinishedCount > 0 ? "Clear finished" : "Clear failed adds"}
        message={<>
          Clear {[
            clearFinishedCount > 0 && `${clearFinishedCount} finished torrent${clearFinishedCount === 1 ? "" : "s"}`,
            clearFailedCount > 0 && `${clearFailedCount} failed add${clearFailedCount === 1 ? "" : "s"}`,
          ].filter(Boolean).join(" and ")}?
          {clearFinishedCount > 0 && " Seeding stops; downloaded files stay on disk."}
        </>}
        confirmLabel="Clear"
        destructive
        onConfirm={() => poofThenRemove(clearable.map((t) => t.id), removeTorrent)}
        onClose={() => setClearOpen(false)}
      />
    </div>
    </CardSizeProvider>
  );
}
