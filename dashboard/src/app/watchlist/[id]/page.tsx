"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { DotsThree, FilmStrip, MagnifyingGlass, Pause, PencilSimple, Play, Television, Trash } from "@phosphor-icons/react";
import {
  getWatchlistEntry,
  triggerWatchlistSearch,
  addWatchlistResult,
  updateWatchlistEntry,
  deleteWatchlistEntry,
  markWatchlistResultsViewed,
  type WatchlistRecord,
  type WatchlistResultRecord,
} from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";
import { sortReleases, RELEASE_SORT_OPTIONS, type ReleaseSortKey } from "@/lib/release-order";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { DetailHero } from "@/components/shared/detail-hero";
import { ReleaseList } from "@/components/shared/release-list";
import { SortDropdown } from "@/components/shared/sort-dropdown";
import { EditEntryModal, type EditEntryData } from "@/components/watchlist/edit-entry-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState, LoadingState, Spinner } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/section";
import { StatusBadge } from "@/components/ui/status-badge";

const relativeOrNever = (ts?: number) => (ts ? formatRelativeTime(ts) : "never");
const absoluteOrNever = (ts?: number) => (ts ? new Date(ts).toLocaleString() : "never");

export default function WatchlistDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [entry, setEntry] = useState<WatchlistRecord | null>(null);
  const [results, setResults] = useState<WatchlistResultRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [resultSort, setResultSort] = usePersistedState<ReleaseSortKey>(
    "fonte.release-sort",
    "match",
    (v): v is ReleaseSortKey => typeof v === "string" && RELEASE_SORT_OPTIONS.some((o) => o.key === v)
  );
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showEdit, setShowEdit] = useState(false);
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
      if (mountedRef.current) setError((err as Error).message);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    mountedRef.current = true;
    fetchData();
    // Opening the page counts as seeing its results; the home card's
    // "N new" badge resets on the next poll.
    markWatchlistResultsViewed(id).catch(() => {});
    const interval = setInterval(fetchData, 10000);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [fetchData, id]);

  const handleSearch = async () => {
    setSearching(true);
    try {
      const res = await triggerWatchlistSearch(id);
      if (mountedRef.current) {
        setResults(res.results);
        setActionError(null);
      }
      markWatchlistResultsViewed(id).catch(() => {});
      fetchData();
    } catch (err) {
      if (mountedRef.current) setActionError((err as Error).message);
    } finally {
      if (mountedRef.current) setSearching(false);
    }
  };

  const handleAddResult = async (resultId: number) => {
    try {
      await addWatchlistResult(id, resultId);
      setActionError(null);
      fetchData();
    } catch (err) {
      setActionError((err as Error).message);
    }
  };

  const runAction = async (fn: () => Promise<void>) => {
    setActionLoading(true);
    try {
      await fn();
      setActionError(null);
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      if (mountedRef.current) setActionLoading(false);
    }
  };

  const handlePauseResume = () =>
    runAction(async () => {
      if (!entry) return;
      await updateWatchlistEntry(id, { status: entry.status === "paused" ? "watching" : "paused" });
      await fetchData();
    });

  const handleEditSave = (data: EditEntryData) =>
    runAction(async () => {
      await updateWatchlistEntry(id, data);
      setShowEdit(false);
      await fetchData();
    });

  const handleDelete = () => {
    if (!confirm("Remove this watchlist entry? This cannot be undone.")) return;
    runAction(async () => {
      await deleteWatchlistEntry(id);
      router.push("/");
    });
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-6">
        <LoadingState label="Loading watchlist entry..." />
      </div>
    );
  }

  if (error || !entry) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-6">
        <EmptyState
          title="Entry not found"
          hint={error || `No watchlist entry with ID "${id}" exists.`}
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/">Back to Watchlist</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const isPaused = entry.status === "paused";
  const MediaIcon = entry.mediaType === "tv" ? Television : FilmStrip;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-6 animate-card-enter">
      <PageHeader
        backHref="/"
        actions={
          <>
            <Button size="sm" onClick={handleSearch} disabled={searching}>
              {searching ? <Spinner size="xs" /> : <MagnifyingGlass weight="bold" />}
              Search Now
            </Button>
            {entry.status !== "fulfilled" && (
              <Button variant="outline" size="sm" onClick={handlePauseResume} disabled={actionLoading}>
                {isPaused ? <Play weight="fill" /> : <Pause weight="fill" />}
                {isPaused ? "Resume" : "Pause"}
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" disabled={actionLoading}>
                  <DotsThree weight="bold" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setShowEdit(true)}>
                  <PencilSimple /> Edit
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onClick={handleDelete}>
                  <Trash /> Remove
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      {actionError && (
        <Callout tone="error" onDismiss={() => setActionError(null)}>
          {actionError}
        </Callout>
      )}

      {entry.status === "fulfilled" && entry.matchedTorrentId && (
        <Callout
          tone="done"
          action={
            <Button asChild size="xs" variant="ghost">
              <Link href={`/torrents/${entry.matchedTorrentId}`}>View torrent</Link>
            </Button>
          }
        >
          Matched and added as torrent.
        </Callout>
      )}

      <DetailHero
        posterUrl={entry.posterUrl}
        title={entry.title}
        titleSuffix={entry.year ? `(${entry.year})` : undefined}
        badges={
          <>
            <Badge tone="neutral" className="gap-1 capitalize">
              <MediaIcon className="size-3" weight="fill" />
              {entry.mediaType === "tv" ? "TV Show" : entry.mediaType}
            </Badge>
            <Badge tone="watch">{entry.quality}</Badge>
            {entry.seasonPattern && <Badge tone="neutral">{entry.seasonPattern}</Badge>}
            <StatusBadge status={entry.status} size="sm" />
          </>
        }
        meta={
          <>
            Checked {relativeOrNever(entry.lastCheckedAt)} · Matched {relativeOrNever(entry.lastMatchAt)} · Added{" "}
            {formatRelativeTime(entry.createdAt)}
          </>
        }
        details={
          <div className="space-y-1 text-2xs text-muted-foreground">
            <p className="break-all font-mono">{entry.searchQuery}</p>
            <p className="tabular-nums">
              Checked {absoluteOrNever(entry.lastCheckedAt)} · Matched {absoluteOrNever(entry.lastMatchAt)} · Added{" "}
              {absoluteOrNever(entry.createdAt)}
            </p>
          </div>
        }
      />

      <Section
        title="Search Results"
        count={results.length}
        action={
          results.length > 0 && (
            <SortDropdown
              value={resultSort}
              onChange={setResultSort}
              options={RELEASE_SORT_OPTIONS}
              ariaLabel={`Sort results, currently ${RELEASE_SORT_OPTIONS.find((o) => o.key === resultSort)?.label ?? resultSort}`}
            />
          )
        }
      >
        {searching ? (
          <LoadingState label="Searching indexers…" />
        ) : (
          <ReleaseList
            results={sortReleases(results, resultSort)}
            actionLabel="Download"
            keyOf={(r) => r.id}
            isSelected={(r) => r.wasSelected}
            onAction={(r) => handleAddResult(r.id)}
            emptyState={
              <EmptyState icon={MagnifyingGlass} title="No results yet" hint='Click "Search Now" to find matching releases.' />
            }
          />
        )}
      </Section>

      {showEdit && (
        <EditEntryModal entry={entry} saving={actionLoading} onClose={() => setShowEdit(false)} onSave={handleEditSave} />
      )}
    </div>
  );
}
