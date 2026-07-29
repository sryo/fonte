"use client";

import React, { useEffect, useRef } from "react";
import { FilmStrip } from "@phosphor-icons/react";
import { poofBurst } from "@/lib/poof-burst";
import { MiddleTruncate } from "@/components/ui/middle-truncate";
import { CardResizeHandle } from "./card-resize";
import { ProgressRing, type RingColor } from "./progress-ring";

export function MediaCard({
  posterUrl,
  title,
  badges,
  primaryAction,
  secondaryAction,
  onClick,
  children,
  progress,
  busy,
  ringColor,
  complete,
  exiting,
  exitDelay = 0,
  hotkeys,
}: {
  posterUrl?: string;
  title: string;
  badges?: React.ReactNode;
  /** Contextual verb: pause, search, run… */
  primaryAction?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  onClick?: () => void;
  /** Key → action while the card itself is focused, e.g. { p: pause, Delete: remove }. */
  hotkeys?: Record<string, () => void>;
  children?: React.ReactNode;
  progress?: { value: number; stalled?: boolean };
  busy?: boolean;
  ringColor?: RingColor;
  complete?: boolean;
  exiting?: boolean;
  exitDelay?: number;
}) {
  const delayStyle = exiting ? { animationDelay: `${exitDelay}ms` } : undefined;
  const cardRef = useRef<HTMLDivElement>(null);
  // Same stagger delay that gates the CSS dissolve, so the two stay in sync.
  useEffect(() => {
    if (!exiting) return;
    const timer = window.setTimeout(() => {
      const rect = cardRef.current?.getBoundingClientRect();
      // Cards scrolled out of view skip the burst — nobody would see it.
      if (!rect || rect.right < 0 || rect.left > window.innerWidth ||
          rect.bottom < 0 || rect.top > window.innerHeight) return;
      poofBurst(rect.left + rect.width / 2, rect.top + rect.height / 2);
    }, exitDelay);
    return () => window.clearTimeout(timer);
  }, [exiting, exitDelay]);
  return (
    <div
      className={`relative${exiting ? " card-poof-collapsing pointer-events-none" : ""}`}
      style={delayStyle}
    >
    <div
      ref={cardRef}
      onClick={exiting ? undefined : onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") onClick?.();
        else if (hotkeys && e.target === e.currentTarget && hotkeys[e.key]) {
          e.preventDefault();
          hotkeys[e.key]();
        }
      }}
      className={`w-(--card-w) h-full rounded-xl shadow-card bg-card overflow-hidden text-left hover:bg-accent/50 transition-colors group cursor-pointer relative focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50${exiting ? " card-poof-dissolving" : ""}`}
      style={delayStyle}
    >
      <div className="aspect-[2/3] w-full bg-muted relative overflow-hidden">
        {posterUrl ? (
          <img src={posterUrl} alt={title} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-muted to-muted/50">
            <FilmStrip className="h-10 w-10 text-muted-foreground/30" />
          </div>
        )}
        {badges && (
          <div className="absolute bottom-2 left-2 right-2 flex flex-wrap gap-1 group-data-[cards=compact]/cards:hidden">
            {badges}
          </div>
        )}
        {(primaryAction || secondaryAction) && (
          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
            {primaryAction && (
              <div className="absolute inset-0 flex items-center justify-center">{primaryAction}</div>
            )}
            {secondaryAction && (
              <div className="absolute bottom-2 right-2">{secondaryAction}</div>
            )}
          </div>
        )}
      </div>
      <div className="p-3 space-y-1">
        <MiddleTruncate text={title} lines={2} className="text-sm font-medium leading-tight group-hover:text-foreground" />
        <div className="group-data-[cards=compact]/cards:hidden">{children}</div>
      </div>
      <ProgressRing progress={progress} busy={busy} color={ringColor} complete={complete} />
      <CardResizeHandle />
    </div>
    </div>
  );
}
