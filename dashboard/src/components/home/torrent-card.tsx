"use client";

import { useRouter } from "next/navigation";
import { Pause, Play, Trash } from "@phosphor-icons/react";
import { pauseTorrent, resumeTorrent, type TorrentRecord } from "@/lib/api";
import { formatSpeed } from "@/lib/format";
import { statusTone } from "@/lib/status";
import { MediaCard } from "@/components/home/media-card";
import { CardAction } from "@/components/home/card-action";
import { PosterBadge } from "@/components/home/poster-badge";

const STATUS_LABEL: Record<string, string> = {
  paused: "Paused",
  checking: "Checking",
  adding: "Adding",
  error: "Error",
};

// Poster card for any unfinished torrent (downloading, paused, checking,
// adding, or errored).
export function TorrentCard({
  torrent,
  exiting,
  exitDelay,
  stalled,
  onRefresh,
  onPoofRemove,
}: {
  torrent: TorrentRecord;
  exiting: boolean;
  exitDelay?: number;
  stalled: boolean;
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
      progress={torrent.status === "adding"
        ? undefined
        : { value: torrent.progress, stalled: stalled || torrent.status === "paused" || torrent.status === "error" }}
      busy={torrent.status === "adding"}
      badges={
        <PosterBadge tone={stalled ? "warn" : statusTone(torrent.status)}>
          {STATUS_LABEL[torrent.status] ?? `${Math.round(torrent.progress * 100)}%`}
        </PosterBadge>
      }
      primaryAction={
        torrent.status === "downloading" ? (
          <CardAction variant="primary" icon={Pause} label="Pause" onClick={async () => { try { await pauseTorrent(torrent.id); } finally { onRefresh(); } }} />
        ) : torrent.status === "paused" ? (
          <CardAction variant="primary" icon={Play} label="Resume" onClick={async () => { try { await resumeTorrent(torrent.id); } finally { onRefresh(); } }} />
        ) : undefined
      }
      secondaryAction={
        <CardAction icon={Trash} label="Remove" destructive onClick={() => {
          if (confirm(`Remove "${torrent.name}"?`)) onPoofRemove();
        }} />
      }
    >
      {torrent.status === "error" ? (
        <p className="text-2xs text-destructive truncate" title={torrent.errorMessage}>
          {torrent.errorMessage || "Download failed"}
        </p>
      ) : (
        <p className="text-2xs text-muted-foreground">
          {torrent.downloadSpeed > 0 && (
            <span className="text-torrent">&darr; {formatSpeed(torrent.downloadSpeed)}{" · "}</span>
          )}
          {torrent.numPeers} peers
        </p>
      )}
    </MediaCard>
  );
}
