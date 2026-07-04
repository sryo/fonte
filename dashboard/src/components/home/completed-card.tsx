"use client";

import { useRouter } from "next/navigation";
import { Check, Play, Stop, Trash } from "@phosphor-icons/react";
import { pauseTorrent, resumeTorrent, type TorrentRecord } from "@/lib/api";
import { formatBytes, formatSpeed, formatShortRelativeTime } from "@/lib/format";
import { MediaCard } from "@/components/home/media-card";
import { CardAction } from "@/components/home/card-action";

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
        <span className="text-2xs bg-done/80 text-white px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
          <Check className="h-2.5 w-2.5" weight="bold" /> {torrent.status === "seeding" ? "Seeding" : "Done"}
        </span>
      }
      actions={
        <>
          {torrent.status === "seeding" && (
            <CardAction icon={Stop} label="Stop seeding" onClick={() => { pauseTorrent(torrent.id); onRefresh(); }} />
          )}
          {torrent.status === "completed" && (
            <CardAction icon={Play} label="Seed" onClick={() => { resumeTorrent(torrent.id); onRefresh(); }} />
          )}
          <CardAction icon={Trash} label="Remove" destructive onClick={onPoofRemove} />
        </>
      }
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
