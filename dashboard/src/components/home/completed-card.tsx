"use client";

import { useRouter } from "next/navigation";
import { FolderOpen, Play, Stop, Trash } from "@phosphor-icons/react";
import { pauseTorrent, resumeTorrent, revealTorrent, type TorrentRecord } from "@/lib/api";
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
  onRemoveRequest,
  onQueueMove,
  queueFlash,
}: {
  torrent: TorrentRecord;
  exiting: boolean;
  exitDelay?: number;
  onRefresh: () => void;
  onRemoveRequest: () => void;
  onQueueMove?: (move: "up" | "down" | "top" | "bottom") => void;
  /** Transient position confirmation after a queue change. */
  queueFlash?: { pos: number; leaving: boolean };
}) {
  const router = useRouter();
  return (
    <MediaCard
      title={torrent.name}
      posterUrl={torrent.posterUrl}
      complete={torrent.status === "seeding"}
      exiting={exiting}
      exitDelay={exitDelay}
      onClick={() => router.push(`/torrents/${torrent.id}`)}
      badges={
        <>
          <PosterBadge tone="done">{torrent.status === "seeding" ? "Seeding" : "Done"}</PosterBadge>
          {queueFlash && (
            <span className={queueFlash.leaving ? "animate-overlay-out" : "animate-overlay-in"}>
              <PosterBadge tone="active">
                {queueFlash.pos === 0 ? "Next" : `#${queueFlash.pos + 1}`}
              </PosterBadge>
            </span>
          )}
        </>
      }
      primaryAction={
        <CardAction
          variant="primary"
          icons={{ active: torrent.status === "seeding" ? "stop" : "play", map: { stop: Stop, play: Play } }}
          label={torrent.status === "seeding" ? "Stop seeding" : "Seed"}
          onClick={async () => {
            try { await (torrent.status === "seeding" ? pauseTorrent : resumeTorrent)(torrent.id); } finally { onRefresh(); }
          }}
        />
      }
      secondaryAction={
        <span className="flex gap-1.5">
          <CardAction icon={FolderOpen} label="Show in Finder" onClick={() => revealTorrent(torrent.id).catch(() => {})} />
          <CardAction icon={Trash} label="Remove" destructive onClick={onRemoveRequest} />
        </span>
      }
      hotkeys={
        onQueueMove && {
          "[": () => onQueueMove("up"),
          "]": () => onQueueMove("down"),
          "{": () => onQueueMove("top"),
          "}": () => onQueueMove("bottom"),
        }
      }
    >
      <p className="text-2xs text-muted-foreground">
        {torrent.status === "seeding" && torrent.uploadSpeed > 0 && (
          <span className="text-green-600 dark:text-green-400">&uarr; {formatSpeed(torrent.uploadSpeed)} &middot; </span>
        )}
        {formatBytes(torrent.size)}
        {torrent.completedAt && ` · ${formatShortRelativeTime(torrent.completedAt)}`}
      </p>
    </MediaCard>
  );
}
