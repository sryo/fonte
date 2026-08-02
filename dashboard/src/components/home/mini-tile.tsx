"use client";

import type { CSSProperties, ElementType, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle, FilmStrip, Lightning, Plus, type IconWeight } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { toPct } from "@/components/ui/progress-bar";
import { ProgressRing, type RingColor } from "@/components/home/progress-ring";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { isFinished } from "@/lib/torrent-order";
import type { TorrentRecord, WatchlistRecord, AutomationRule } from "@/lib/api";

/** view-transition-name must be a valid CSS ident; ids are sanitized into one. */
export function vtName(prefix: string, id: string): string {
  return `hi-${prefix}-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

type MiniRing = {
  progress?: { value: number; stalled?: boolean };
  busy?: boolean;
  color?: RingColor;
  complete?: boolean;
};

/** Tiny fixed-size rendition of a home card for collapsed sections: poster (or
    icon), the same border progress ring the full cards use, and a tooltip
    carrying what the full card says in text. Deliberately not tied to --card-w. */
export function MiniTile({
  title,
  subtitle,
  posterUrl,
  icon: Icon = FilmStrip,
  iconClassName = "h-4 w-4 text-muted-foreground/30",
  iconWeight,
  badge,
  dimmed = false,
  ring,
  onClick,
  exiting = false,
  exitDelay = 0,
  transitionName,
}: {
  title: string;
  subtitle: string;
  posterUrl?: string;
  icon?: ElementType;
  iconClassName?: string;
  iconWeight?: IconWeight;
  badge?: ReactNode;
  dimmed?: boolean;
  ring?: MiniRing;
  onClick?: () => void;
  exiting?: boolean;
  exitDelay?: number;
  transitionName?: string;
}) {
  const style: CSSProperties = {};
  if (transitionName) style.viewTransitionName = transitionName;
  if (exiting) style.animationDelay = `${exitDelay}ms`;

  return (
    <div className={cn(exiting && "card-poof-dissolving pointer-events-none")} style={style}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={exiting ? undefined : onClick}
              aria-label={`${title} — ${subtitle}`}
              className={cn(
                "relative block w-10 h-15 rounded-md overflow-hidden bg-muted shadow-card cursor-pointer",
                "transition-shadow hover:ring-2 hover:ring-ring/40",
                "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                dimmed && "opacity-60 saturate-50"
              )}
            >
              {posterUrl ? (
                <img src={posterUrl} alt="" loading="lazy" className="w-full h-full object-cover" />
              ) : (
                <span className="w-full h-full flex items-center justify-center bg-gradient-to-br from-muted to-muted/50">
                  <Icon className={iconClassName} weight={iconWeight} />
                </span>
              )}
              {badge}
              {ring && <ProgressRing {...ring} className="progress-ring--mini" />}
            </button>
          </TooltipTrigger>
          <TooltipContent className="whitespace-pre-line text-center">
            {`${title}\n${subtitle}`}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

export function TorrentMiniTile({
  torrent,
  exiting,
  exitDelay,
}: {
  torrent: TorrentRecord;
  exiting: boolean;
  exitDelay?: number;
}) {
  const router = useRouter();
  const pct = toPct(torrent.progress);

  // Same ring rules as TorrentCard/CompletedCard, at mini scale.
  let subtitle: string;
  let ring: MiniRing | undefined;
  if (isFinished(torrent)) {
    if (torrent.status === "seeding") {
      subtitle = "Seeding";
      ring = { complete: true };
    } else {
      subtitle = "Done";
    }
  } else if (torrent.status === "adding") {
    subtitle = "Adding…";
    ring = { busy: true };
  } else if (torrent.status === "error") {
    subtitle = torrent.errorMessage || "Download failed";
    ring = { progress: { value: torrent.progress, stalled: true } };
  } else {
    subtitle = `${pct}% · ${torrent.status}`;
    ring = {
      progress: {
        value: torrent.progress,
        stalled: !!torrent.stalledSince || torrent.status === "paused",
      },
    };
  }

  return (
    <MiniTile
      title={torrent.name}
      subtitle={subtitle}
      posterUrl={torrent.posterUrl}
      ring={ring}
      badge={
        torrent.status === "error" ? (
          <span aria-hidden className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-destructive" />
        ) : undefined
      }
      onClick={() => router.push(`/torrents/${torrent.id}`)}
      exiting={exiting}
      exitDelay={exitDelay}
      transitionName={vtName("t", torrent.id)}
    />
  );
}

export function WatchlistMiniTile({
  entry,
  searching,
  exiting,
  exitDelay,
}: {
  entry: WatchlistRecord;
  searching: boolean;
  exiting: boolean;
  exitDelay?: number;
}) {
  const router = useRouter();
  const newCount = entry.newResultsCount ?? 0;
  const status = searching ? "Searching…" : `${entry.quality} · ${entry.status}`;
  const subtitle = newCount > 0 ? `${status} · ${newCount} new` : status;

  return (
    <MiniTile
      title={entry.title}
      subtitle={subtitle}
      posterUrl={entry.posterUrl}
      dimmed={entry.status === "paused"}
      ring={searching ? { busy: true, color: "watchlist" } : undefined}
      badge={
        newCount > 0 ? (
          <span className="absolute top-0.5 right-0.5 min-w-3.5 h-3.5 px-0.5 rounded-full bg-watchlist text-white text-2xs flex items-center justify-center tabular-nums">
            {newCount}
          </span>
        ) : undefined
      }
      onClick={() => router.push(`/watchlist/${entry.id}`)}
      exiting={exiting}
      exitDelay={exitDelay}
      transitionName={vtName("w", entry.id)}
    />
  );
}

export function AutomationMiniTile({
  rule,
  running,
  onClick,
}: {
  rule: AutomationRule;
  running: boolean;
  onClick: () => void;
}) {
  return (
    <MiniTile
      title={rule.name}
      subtitle={running ? "Running…" : rule.triggerType.replace(":", " ")}
      icon={Lightning}
      iconClassName="h-4 w-4 text-automation"
      iconWeight="fill"
      ring={running ? { busy: true, color: "automation" } : undefined}
      onClick={onClick}
      transitionName={vtName("a", rule.id)}
    />
  );
}

export function TrayMiniTile({ count, onExpand }: { count: number; onExpand: () => void }) {
  return (
    <MiniTile
      title="Fulfilled"
      subtitle={`${count} matched · click to expand`}
      icon={CheckCircle}
      iconClassName="h-4 w-4 text-done"
      iconWeight="fill"
      badge={
        <span className="absolute top-0.5 right-0.5 min-w-3.5 h-3.5 px-0.5 rounded-full bg-done text-white text-2xs flex items-center justify-center tabular-nums">
          {count}
        </span>
      }
      onClick={onExpand}
    />
  );
}

export function AddMiniTile({
  label,
  onClick,
  transitionName,
}: {
  label: string;
  onClick: () => void;
  transitionName?: string;
}) {
  return (
    <div style={transitionName ? ({ viewTransitionName: transitionName } as CSSProperties) : undefined}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onClick}
              aria-label={label}
              className="w-10 h-15 rounded-md border border-dashed bg-card/30 flex items-center justify-center text-muted-foreground/50 hover:text-foreground hover:bg-accent/50 hover:border-foreground/30 transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <Plus className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
