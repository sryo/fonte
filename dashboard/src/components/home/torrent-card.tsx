"use client";

import { useRouter } from "next/navigation";
import { Pause, Play, Trash } from "@phosphor-icons/react";
import { pauseTorrent, resumeTorrent, type TorrentRecord } from "@/lib/api";
import { formatSpeed } from "@/lib/format";
import { MediaCard } from "@/components/home/media-card";
import { CardAction } from "@/components/home/card-action";
import { StatusBadge } from "@/components/ui/status-badge";

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
      progress={{ value: torrent.progress, stalled: stalled || torrent.status === "paused" }}
      badges={
        <>
          <StatusBadge status={torrent.status} />
          <span className="text-2xs bg-black/60 text-white px-1.5 py-0.5 rounded-full">
            {Math.round(torrent.progress * 100)}%
          </span>
        </>
      }
      actions={
        <>
          {torrent.status === "downloading" && (
            <CardAction icon={Pause} label="Pause" onClick={() => { pauseTorrent(torrent.id); onRefresh(); }} />
          )}
          {torrent.status === "paused" && (
            <CardAction icon={Play} label="Resume" onClick={() => { resumeTorrent(torrent.id); onRefresh(); }} />
          )}
          <CardAction icon={Trash} label="Remove" destructive onClick={() => {
            if (confirm(`Remove "${torrent.name}"?`)) onPoofRemove();
          }} />
        </>
      }
    >
      {torrent.status === "error" ? (
        <p className="text-2xs text-destructive truncate" title={torrent.errorMessage}>
          {torrent.errorMessage || "Download failed"}
        </p>
      ) : (
        <p className="text-2xs text-muted-foreground">
          <span className="text-torrent">&darr; {formatSpeed(torrent.downloadSpeed)}</span>
          {" · "}{torrent.numPeers} peers
        </p>
      )}
    </MediaCard>
  );
}
