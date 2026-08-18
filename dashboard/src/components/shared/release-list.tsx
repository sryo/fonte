"use client";

import { useState, type ReactNode } from "react";
import { Check, ThumbsDown, ThumbsUp } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/feedback";
import { MiddleTruncate } from "@/components/ui/middle-truncate";
import { formatBytes, formatShortRelativeTime } from "@/lib/format";
import { qualityTone, TONE_TEXT } from "@/lib/status";
import { cn } from "@/lib/utils";

export interface ReleaseItem {
  title: string;
  seeders: number;
  leechers: number;
  size: number;
  qualityMatch: number;
  indexer?: string;
  publishDate?: number;
}

/** Search-result rows in the torrent-files idiom; replaces the raw tables. */
export function ReleaseList<T extends ReleaseItem>({
  results,
  actionLabel,
  onAction,
  isSelected,
  keyOf,
  emptyState,
  feedbackOf,
  isBlocked,
  onFeedback,
}: {
  results: T[];
  actionLabel: string;
  onAction: (r: T) => void | Promise<void>;
  isSelected?: (r: T) => boolean;
  keyOf: (r: T) => string | number;
  emptyState?: ReactNode;
  feedbackOf?: (r: T) => "up" | "down" | null;
  isBlocked?: (r: T) => boolean;
  onFeedback?: (r: T, next: "up" | "down" | null) => void | Promise<void>;
}) {
  const [busyKey, setBusyKey] = useState<string | number | null>(null);
  const [rowError, setRowError] = useState<{ key: string | number; message: string } | null>(null);

  if (results.length === 0) return <>{emptyState}</>;

  const run = async (key: string | number, fn: () => void | Promise<void>) => {
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

  const voteButton = (r: T, dir: "up" | "down") => {
    const active = feedbackOf?.(r) === dir;
    const Icon = dir === "up" ? ThumbsUp : ThumbsDown;
    return (
      <button
        title={dir === "up" ? "Prefer releases like this" : "Never auto-add this release"}
        disabled={busyKey !== null}
        onClick={() => run(keyOf(r), () => onFeedback!(r, active ? null : dir))}
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
    <div className="space-y-2">
      {results.map((r) => {
        const key = keyOf(r);
        const selected = isSelected?.(r) ?? false;
        const blocked = isBlocked?.(r) ?? false;
        const rejected = blocked || feedbackOf?.(r) === "down";
        return (
          <div
            key={key}
            className={cn(
              "group flex items-center gap-3 rounded-md border px-3 py-2",
              rejected && "opacity-60",
            )}
          >
            <div className="min-w-0 flex-1">
              <MiddleTruncate text={r.title} className="text-sm font-medium" />
              <p className="text-xs text-muted-foreground tabular-nums">
                ↑ {r.seeders} / {r.leechers} · {formatBytes(r.size)} ·{" "}
                <span className={cn(TONE_TEXT[qualityTone(r.qualityMatch)])}>
                  {r.qualityMatch}%
                </span>
                {r.indexer && <> · {r.indexer}</>}
                {r.publishDate && <> · {formatShortRelativeTime(r.publishDate)}</>}
                {rejected && <> · won't auto-add</>}
              </p>
              {rowError?.key === key && (
                <p className="text-xs text-destructive">{rowError.message}</p>
              )}
            </div>
            {onFeedback && (
              <div className="flex shrink-0 items-center">
                {voteButton(r, "up")}
                {voteButton(r, "down")}
              </div>
            )}
            {selected ? (
              <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-done">
                <Check className="size-3.5" /> Added
              </span>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                disabled={busyKey !== null}
                onClick={() => run(key, () => onAction(r))}
              >
                {busyKey === key && <Spinner size="xs" />}
                {actionLabel}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
