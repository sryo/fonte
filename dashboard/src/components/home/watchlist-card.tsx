"use client";

import { useRouter } from "next/navigation";
import { MagnifyingGlass, Trash } from "@phosphor-icons/react";
import type { WatchlistRecord } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";
import { MediaCard } from "@/components/home/media-card";
import { CardAction } from "@/components/home/card-action";
import { StatusBadge } from "@/components/ui/status-badge";

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
          <StatusBadge status={entry.status} />
          <span className="text-2xs bg-black/60 text-white px-1.5 py-0.5 rounded-full">
            {entry.quality}
          </span>
        </>
      }
      actions={
        <>
          <CardAction
            icon={MagnifyingGlass}
            label={entry.lastCheckedAt ? `Search now\nLast searched: ${formatRelativeTime(entry.lastCheckedAt)}` : "Search now\nNever searched"}
            onClick={onSearch}
          />
          <CardAction icon={Trash} label="Remove" destructive onClick={() => {
            if (confirm(`Remove "${entry.title}" from watchlist?`)) onPoofRemove();
          }} />
        </>
      }
    >
      <p className="text-2xs text-muted-foreground">
        {entry.year && `${entry.year} · `}{entry.mediaType === "tv" ? "TV Show" : entry.mediaType.charAt(0).toUpperCase() + entry.mediaType.slice(1)}
      </p>
    </MediaCard>
  );
}
