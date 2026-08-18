"use client";

import { useMemo, useState, type ReactNode } from "react";
import { CaretDown, CaretRight, Check, DownloadSimple, ThumbsDown, ThumbsUp } from "@phosphor-icons/react";
import type { WatchlistResultRecord } from "@/lib/api";
import { formatBytes, formatShortRelativeTime } from "@/lib/format";
import {
  groupReleases,
  resolutionMatches,
  resolutionTag,
  seederTone,
  type ReleaseGroup,
} from "@/lib/release-groups";
import type { ReleaseSortKey } from "@/lib/release-order";
import { TONE_DOT } from "@/lib/status";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/feedback";

export function ReleaseGroupList({
  results,
  wantedQuality,
  sortKey,
  onAdd,
  onFeedback,
  emptyState,
}: {
  results: WatchlistResultRecord[];
  wantedQuality: string;
  sortKey: ReleaseSortKey;
  onAdd: (resultId: number) => Promise<void>;
  onFeedback: (resultId: number, next: "up" | "down" | null) => Promise<void>;
  emptyState?: ReactNode;
}) {
  const grouped = useMemo(() => groupReleases(results, sortKey), [results, sortKey]);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [busyKey, setBusyKey] = useState<number | null>(null);
  const [rowError, setRowError] = useState<{ key: number; message: string } | null>(null);

  if (results.length === 0) return <>{emptyState}</>;

  const run = async (key: number, fn: () => void | Promise<void>) => {
    setBusyKey(key);
    setRowError(null);
    try {
      await fn();
    } catch (err) {
      setRowError({ key, message: (err as Error).message });
    } finally {
      setBusyKey(null);
    }
  };

  const row = (r: WatchlistResultRecord) => {
    const tag = resolutionTag(r.title);
    const blocked = r.feedback === -1 || r.autoBlocked;
    const busy = busyKey === r.id;
    const vote = (dir: "up" | "down") => {
      const active = (dir === "up" ? 1 : -1) === r.feedback;
      const Icon = dir === "up" ? ThumbsUp : ThumbsDown;
      return (
        <button
          title={dir === "up" ? "Prefer releases like this" : "Never auto-add this release"}
          disabled={busyKey !== null}
          onClick={() => run(r.id, () => onFeedback(r.id, active ? null : dir))}
          className={cn(
            "rounded p-1 transition-all focus-visible:opacity-100 group-hover:opacity-100",
            active
              ? cn("opacity-100", dir === "up" ? "text-done" : "text-destructive")
              : "opacity-0 text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="size-3.5" weight={active ? "fill" : "regular"} />
        </button>
      );
    };
    return (
      <div
        key={r.id}
        className={cn(
          "group flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/50",
          blocked && "opacity-55",
        )}
      >
        <span
          className={cn(
            "w-11 shrink-0 rounded px-1 py-0.5 text-center text-[11px] font-semibold tabular-nums",
            resolutionMatches(tag, wantedQuality)
              ? "bg-done/15 text-done"
              : "bg-muted text-muted-foreground",
          )}
        >
          {tag}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium" title={r.indexer ? `${r.title} · ${r.indexer}` : r.title}>
            {r.title}
          </p>
          {rowError?.key === r.id && <p className="text-xs text-destructive">{rowError.message}</p>}
        </div>
        {blocked && (
          <span className="shrink-0 text-[11px] text-muted-foreground">won't auto-add</span>
        )}
        <div className="flex shrink-0 items-center">
          {vote("up")}
          {vote("down")}
          {r.wasSelected ? (
            <span className="flex items-center gap-1 pl-1 text-[11px] font-medium text-done">
              <Check className="size-3" /> Added
            </span>
          ) : (
            <button
              title="Download"
              disabled={busyKey !== null}
              onClick={() => run(r.id, () => onAdd(r.id))}
              className="rounded p-1 text-muted-foreground opacity-0 transition-all hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
            >
              {busy ? <Spinner size="xs" /> : <DownloadSimple className="size-3.5" />}
            </button>
          )}
        </div>
        <span className="flex w-14 shrink-0 items-center justify-end gap-1 text-xs tabular-nums">
          <span className={cn("size-1.5 rounded-full", TONE_DOT[seederTone(r.seeders)])} />
          {r.seeders}
        </span>
        <span className="w-17 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
          {formatBytes(r.size)}
        </span>
        <span className="w-10 shrink-0 text-right text-xs whitespace-nowrap text-muted-foreground tabular-nums">
          {r.publishDate ? formatShortRelativeTime(r.publishDate).replace(/\sago$/, "") : "—"}
        </span>
      </div>
    );
  };

  if (grouped.mode === "flat") {
    return <div className="flex flex-col">{grouped.results.map(row)}</div>;
  }

  const groupHeader = (g: ReleaseGroup<WatchlistResultRecord>, expanded: boolean) => (
    <button
      aria-expanded={expanded}
      onClick={() => setOverrides((prev) => ({ ...prev, [g.key]: !expanded }))}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/50"
    >
      <span className="text-muted-foreground">
        {expanded ? <CaretDown className="size-3" /> : <CaretRight className="size-3" />}
      </span>
      <span className="text-xs font-semibold">{g.label}</span>
      <span className="text-2xs text-muted-foreground tabular-nums">{g.results.length} {g.results.length === 1 ? "release" : "releases"}</span>
      {g.downloaded && (
        <span className="flex items-center gap-1 rounded-full bg-done/15 px-1.5 py-px text-[11px] font-medium text-done">
          <Check className="size-3" /> Downloaded
        </span>
      )}
    </button>
  );

  return (
    <div className="flex flex-col">
      {grouped.groups.map((g) => {
        const expanded = overrides[g.key] ?? !g.collapsedByDefault;
        return (
          <div key={g.key}>
            {groupHeader(g, expanded)}
            {expanded && (
              <div className="ml-3 flex flex-col border-l pl-2">{g.results.map(row)}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
