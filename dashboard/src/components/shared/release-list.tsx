"use client";

import { useState, type ReactNode } from "react";
import { Check } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/feedback";
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
}: {
  results: T[];
  actionLabel: string;
  onAction: (r: T) => void | Promise<void>;
  isSelected?: (r: T) => boolean;
  keyOf: (r: T) => string | number;
  emptyState?: ReactNode;
}) {
  const [busyKey, setBusyKey] = useState<string | number | null>(null);

  if (results.length === 0) return <>{emptyState}</>;

  const act = async (r: T) => {
    setBusyKey(keyOf(r));
    try {
      await onAction(r);
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="space-y-2">
      {results.map((r) => {
        const key = keyOf(r);
        const selected = isSelected?.(r) ?? false;
        return (
          <div key={key} className="flex items-center gap-3 rounded-md border px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{r.title}</p>
              <p className="text-xs text-muted-foreground tabular-nums">
                ↑ {r.seeders} / {r.leechers} · {formatBytes(r.size)} ·{" "}
                <span className={cn(TONE_TEXT[qualityTone(r.qualityMatch)])}>
                  {r.qualityMatch}%
                </span>
                {r.indexer && <> · {r.indexer}</>}
                {r.publishDate && <> · {formatShortRelativeTime(r.publishDate)}</>}
              </p>
            </div>
            {selected ? (
              <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-done">
                <Check className="size-3.5" /> Added
              </span>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                disabled={busyKey !== null}
                onClick={() => act(r)}
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
