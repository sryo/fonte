"use client";

import { useRouter } from "next/navigation";
import { MagnifyingGlass, Trash } from "@phosphor-icons/react";
import type { WatchlistRecord } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";
import { stackDepthForCount } from "@/lib/stack-visual";
import { CardStack } from "@/components/home/card-stack";
import { MediaCard } from "@/components/home/media-card";
import { CardAction } from "@/components/home/card-action";
import { PosterBadge } from "@/components/home/poster-badge";

// Poster card for a watchlist entry; the watchlist-colored ring spins
// (indeterminate) while a manual search is in flight.
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
  return (
    <CardStack depth={stackDepthForCount(entry.newResultsCount ?? 0)} seed={entry.id}>
    <MediaCard
      title={entry.title}
      posterUrl={entry.posterUrl}
      exiting={exiting}
      exitDelay={exitDelay}
      onClick={() => router.push(`/watchlist/${entry.id}`)}
      busy={searching}
      ringColor="watchlist"
      badges={
        <>
          {(entry.newResultsCount ?? 0) > 0 && (
            <span className="text-2xs font-medium bg-watchlist text-white px-1.5 py-0.5 rounded-full">
              {entry.newResultsCount} new
            </span>
          )}
          {entry.status === "paused" && <PosterBadge tone="neutral">Paused</PosterBadge>}
          <PosterBadge>{entry.quality}</PosterBadge>
        </>
      }
      primaryAction={
        <CardAction
          variant="primary"
          icon={MagnifyingGlass}
          label={entry.lastCheckedAt ? `Search now\nLast searched: ${formatRelativeTime(entry.lastCheckedAt)}` : "Search now\nNever searched"}
          onClick={onSearch}
        />
      }
      secondaryAction={
        <CardAction icon={Trash} label="Remove" destructive onClick={() => {
          if (confirm(`Remove "${entry.title}" from watchlist?`)) onPoofRemove();
        }} />
      }
    >
      <p className="text-2xs text-muted-foreground">
        {entry.year && `${entry.year} · `}{entry.mediaType === "tv" ? "TV Show" : entry.mediaType.charAt(0).toUpperCase() + entry.mediaType.slice(1)}
      </p>
    </MediaCard>
    </CardStack>
  );
}
