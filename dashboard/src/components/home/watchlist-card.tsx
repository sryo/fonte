"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MagnifyingGlass, Trash } from "@phosphor-icons/react";
import type { WatchlistRecord } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";
import { MediaCard } from "@/components/home/media-card";
import { CardAction } from "@/components/home/card-action";
import { PosterBadge } from "@/components/home/poster-badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

// The ring spins while a manual search is in flight.
export function WatchlistCard({
  entry,
  exiting,
  exitDelay,
  searching,
  onSearch,
  onPoofRemove,
}: {
  entry: WatchlistRecord;
  exiting: boolean;
  exitDelay?: number;
  searching: boolean;
  onSearch: () => void;
  onPoofRemove: () => void;
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const fulfilled = entry.status === "fulfilled";
  const found = entry.status === "watching" && (entry.newResultsCount ?? 0) > 0;
  return (
    <>
    <MediaCard
      title={entry.title}
      posterUrl={entry.posterUrl}
      exiting={exiting}
      exitDelay={exitDelay}
      onClick={() => router.push(`/watchlist/${entry.id}`)}
      busy={searching}
      ringColor={fulfilled ? undefined : "watchlist"}
      complete={fulfilled || found ? "still" : false}
      badges={
        <>
          {(entry.newResultsCount ?? 0) > 0 && (
            <span className="text-xs font-bold bg-foreground text-background px-2 py-0.5 rounded-full">
              {entry.newResultsCount} new
            </span>
          )}
          {entry.status === "paused" && <PosterBadge>Paused</PosterBadge>}
          {entry.lastError && <PosterBadge tone="error">Check failed</PosterBadge>}
          {fulfilled && <PosterBadge>Fulfilled</PosterBadge>}
          <PosterBadge>{entry.quality}</PosterBadge>
        </>
      }
      primaryAction={
        <CardAction
          variant="primary"
          icon={MagnifyingGlass}
          label={
            entry.lastError
              ? `Search now\nLast check failed${entry.lastErrorAt ? ` ${formatRelativeTime(entry.lastErrorAt)}` : ""}: ${entry.lastError}`
              : entry.lastCheckedAt
                ? `Search now\nLast searched: ${formatRelativeTime(entry.lastCheckedAt)}`
                : "Search now\nNever searched"
          }
          kbd="S"
          onClick={onSearch}
        />
      }
      secondaryAction={
        <CardAction icon={Trash} label="Remove" kbd="⌫" destructive onClick={() => setConfirmOpen(true)} />
      }
      hotkeys={{
        s: onSearch,
        Delete: () => setConfirmOpen(true),
        Backspace: () => setConfirmOpen(true),
      }}
    >
      <p className="text-2xs text-muted-foreground">
        {entry.mediaType === "tv" && entry.seasonPattern
          ? `${entry.seasonPattern.toUpperCase()} · `
          : entry.year
            ? `${entry.year} · `
            : ""}
        {entry.mediaType === "tv" ? "TV Show" : entry.mediaType.charAt(0).toUpperCase() + entry.mediaType.slice(1)}
      </p>
    </MediaCard>
    <ConfirmDialog
      open={confirmOpen}
      title="Remove from watchlist"
      message={<>Remove “{entry.title}” from the watchlist?</>}
      confirmLabel="Remove"
      destructive
      onConfirm={onPoofRemove}
      onClose={() => setConfirmOpen(false)}
    />
    </>
  );
}
