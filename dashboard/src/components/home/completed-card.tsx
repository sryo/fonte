"use client";

import { useRouter } from "next/navigation";
import { Play, Stop, Trash } from "@phosphor-icons/react";
import { pauseTorrent, resumeTorrent, type TorrentRecord } from "@/lib/api";
import { formatBytes, formatSpeed, formatShortRelativeTime } from "@/lib/format";
import { MediaCard } from "@/components/home/media-card";
import { CardAction } from "@/components/home/card-action";
import { PosterBadge } from "@/components/home/poster-badge";

// Poster card for a finished torrent (seeding, or completed = finished and stopped).
export function CompletedCard({
  torrent,
  exiting,
  exitDelay,
  onRefresh,
  onPoofRemove,
}: {
  torrent: TorrentRecord;
  exiting: boolean;
  exitDelay?: number;
  onRefresh: () => void;
  onPoofRemove: () => void;
}) {
  const router = useRouter();
  return (
    <MediaCard
      title={torrent.name}
      posterUrl={torrent.posterUrl}
      exiting={exiting}
      exitDelay={exitDelay}
      onClick={() => router.push(`/torrents/${torrent.id}`)}
      badges={
        <PosterBadge tone="done">{torrent.status === "seeding" ? "Seeding" : "Done"}</PosterBadge>
      }
      primaryAction={
        torrent.status === "seeding" ? (
          <CardAction variant="primary" icon={Stop} label="Stop seeding" onClick={() => { pauseTorrent(torrent.id); onRefresh(); }} />
        ) : (
          <CardAction variant="primary" icon={Play} label="Seed" onClick={() => { resumeTorrent(torrent.id); onRefresh(); }} />
        )
      }
      secondaryAction={<CardAction icon={Trash} label="Remove" destructive onClick={onPoofRemove} />}
    >
      <p className="text-2xs text-muted-foreground">
        {torrent.status === "seeding" && (
          <span className="text-green-600 dark:text-green-400">&uarr; {formatSpeed(torrent.uploadSpeed)} &middot; </span>
        )}
        {formatBytes(torrent.size)}
        {torrent.completedAt && ` · ${formatShortRelativeTime(torrent.completedAt)}`}
      </p>
    </MediaCard>
  );
}
