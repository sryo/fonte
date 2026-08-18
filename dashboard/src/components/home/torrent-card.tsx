"use client";

import { useRouter } from "next/navigation";
import { Pause, Play, Trash } from "@phosphor-icons/react";
import { pauseTorrent, resumeTorrent, type TorrentRecord } from "@/lib/api";
import { formatSpeed } from "@/lib/format";
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
  onQueueMove,
  queueFlash,
}: {
  torrent: TorrentRecord;
  exiting: boolean;
  exitDelay?: number;
  stalled: boolean;
  onRefresh: () => void;
  onRemoveRequest: () => void;
  onQueueMove?: (move: "up" | "down" | "top" | "bottom") => void;
  /** Transient position confirmation after a queue change. */
  queueFlash?: { pos: number; leaving: boolean };
}) {
  const router = useRouter();
  const pauseResume =
    torrent.status === "downloading" || torrent.status === "queued"
      ? { active: "pause", label: "Pause", run: async () => { try { await pauseTorrent(torrent.id); } finally { onRefresh(); } } }
      : torrent.status === "paused"
      ? { active: "play", label: "Resume", run: async () => { try { await resumeTorrent(torrent.id); } finally { onRefresh(); } } }
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
        : { value: torrent.progress, stalled: stalled || torrent.status === "paused" || torrent.status === "error" || torrent.status === "queued" }}
      busy={torrent.status === "adding"}
      badges={
        <>
          <PosterBadge tone={stalled ? "warn" : undefined}>
            {torrent.status === "queued"
              ? `Queued #${(torrent.queuePosition ?? 0) + 1}`
              : STATUS_LABEL[torrent.status] ?? `${toPct(torrent.progress)}%`}
          </PosterBadge>
          {queueFlash && torrent.status !== "queued" && (
            <span className={queueFlash.leaving ? "animate-overlay-out" : "animate-overlay-in"}>
              <PosterBadge>
                {queueFlash.pos === 0 ? "Next" : `#${queueFlash.pos + 1}`}
              </PosterBadge>
            </span>
          )}
        </>
      }
      primaryAction={
        pauseResume && (
          <CardAction
            variant="primary"
            icons={{ active: pauseResume.active, map: { pause: Pause, play: Play } }}
            label={pauseResume.label}
            kbd="P"
            onClick={pauseResume.run}
          />
        )
      }
      secondaryAction={
        <CardAction icon={Trash} label="Remove" kbd="⌫" destructive onClick={onRemoveRequest} />
      }
      hotkeys={{
        ...(pauseResume && { p: pauseResume.run }),
        ...(onQueueMove && {
          "[": () => onQueueMove("up"),
          "]": () => onQueueMove("down"),
          "{": () => onQueueMove("top"),
          "}": () => onQueueMove("bottom"),
        }),
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
