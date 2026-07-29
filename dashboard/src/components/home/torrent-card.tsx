"use client";

import { useRouter } from "next/navigation";
import { Pause, Play, Trash } from "@phosphor-icons/react";
import { pauseTorrent, resumeTorrent, type TorrentRecord } from "@/lib/api";
import { formatSpeed } from "@/lib/format";
import { statusTone } from "@/lib/status";
import { toPct } from "@/components/ui/progress-bar";
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
  onRemoveRequest,
}: {
  torrent: TorrentRecord;
  exiting: boolean;
  exitDelay?: number;
  stalled: boolean;
  onRefresh: () => void;
  onRemoveRequest: () => void;
}) {
  const router = useRouter();
  const pauseResume =
    torrent.status === "downloading"
      ? { icon: Pause, label: "Pause", run: async () => { try { await pauseTorrent(torrent.id); } finally { onRefresh(); } } }
      : torrent.status === "paused"
      ? { icon: Play, label: "Resume", run: async () => { try { await resumeTorrent(torrent.id); } finally { onRefresh(); } } }
      : undefined;
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
          {STATUS_LABEL[torrent.status] ?? `${toPct(torrent.progress)}%`}
        </PosterBadge>
      }
      primaryAction={
        pauseResume && (
          <CardAction variant="primary" icon={pauseResume.icon} label={pauseResume.label} onClick={pauseResume.run} hotkey="P" />
        )
      }
      secondaryAction={
        <CardAction icon={Trash} label="Remove" destructive onClick={onRemoveRequest} hotkey="⌫" />
      }
      hotkeys={{
        ...(pauseResume && { p: pauseResume.run }),
        Delete: onRemoveRequest,
        Backspace: onRemoveRequest,
      }}
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
