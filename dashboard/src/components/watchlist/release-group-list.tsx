"use client";

import { useMemo, useState, type ReactNode } from "react";
import { CaretDown, CaretRight, Check, ThumbsDown, ThumbsUp } from "@phosphor-icons/react";
import type { MediaType, WatchlistResultRecord } from "@/lib/api";
import { formatBytes, formatShortRelativeTime } from "@/lib/format";
import {
  formatMatches,
  formatTag,
  groupReleases,
  seederTone,
  type ReleaseGroup,
} from "@/lib/release-groups";
import type { ReleaseSortKey } from "@/lib/release-order";
import { TONE_TEXT } from "@/lib/status";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/feedback";
import { GhostCount } from "@/components/ui/ghost-count";

export function ReleaseGroupList({
  results,
  wantedQuality,
  kind,
  sortKey,
  onAdd,
  onFeedback,
  emptyState,
}: {
  results: WatchlistResultRecord[];
  wantedQuality: string;
  kind: MediaType;
  sortKey: ReleaseSortKey;
  onAdd: (resultId: number) => Promise<void>;
  onFeedback: (resultId: number, next: "up" | "down" | null) => Promise<void>;
  emptyState?: ReactNode;
}) {
  const grouped = useMemo(() => groupReleases(results, sortKey, kind), [results, sortKey, kind]);
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
    const tag = formatTag(r.title, kind);
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
              : "opacity-0 text-foreground group-hover:opacity-50 hover:opacity-100",
          )}
        >
          <Icon className="size-4.5" weight={active ? "fill" : "regular"} />
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
        {tag && (
          <span
            className={cn(
              "w-11 shrink-0 text-center text-[11px] tabular-nums",
              formatMatches(tag, wantedQuality, kind)
                ? "font-extrabold text-foreground"
                : "font-bold text-ghost-dim",
            )}
          >
            {tag}
          </span>
        )}
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
              disabled={busyKey !== null}
              onClick={() => run(r.id, () => onAdd(r.id))}
              className="ml-1 flex h-6 items-center rounded-full bg-foreground px-2.5 text-xs font-extrabold text-background transition-opacity hover:opacity-85 disabled:opacity-40"
            >
              {busy ? <Spinner size="xs" /> : "Get"}
            </button>
          )}
        </div>
        <span className={cn("w-14 shrink-0 text-right text-xs font-extrabold tabular-nums", TONE_TEXT[seederTone(r.seeders)])}>
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
      <span className="text-base font-black">{g.label}</span>
      <GhostCount count={g.results.length} className="text-base" />
      {g.downloaded && (
        <span className="text-xs font-extrabold text-done">Downloaded</span>
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
