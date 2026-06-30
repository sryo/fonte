"use client";

import React from "react";
import { FilmStrip } from "@phosphor-icons/react";
import { ProgressRing, type RingColor } from "./progress-ring";

export function MediaCard({
  posterUrl,
  title,
  badges,
  actions,
  onClick,
  children,
  progress,
  busy,
  ringColor,
  exiting,
  exitDelay = 0,
}: {
  posterUrl?: string;
  title: string;
  badges?: React.ReactNode;
  actions?: React.ReactNode;
  onClick?: () => void;
  children?: React.ReactNode;
  progress?: { value: number; stalled?: boolean };
  busy?: boolean;
  ringColor?: RingColor;
  exiting?: boolean;
  exitDelay?: number;
}) {
  const delayStyle = exiting ? { animationDelay: `${exitDelay}ms` } : undefined;
  return (
    <div
      className={`relative${exiting ? " card-poof-collapsing pointer-events-none" : ""}`}
      style={delayStyle}
    >
      {exiting && (
        <div
          aria-hidden
          className="card-poof-sprite absolute left-[5.5rem] top-1/2 -translate-x-1/2 -translate-y-1/2 z-10"
          style={delayStyle}
        />
      )}
    <div
      onClick={exiting ? undefined : onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") onClick?.(); }}
      className={`w-44 h-full rounded-xl shadow-sm border bg-card overflow-hidden text-left hover:bg-accent/50 transition-colors group cursor-pointer relative${exiting ? " card-poof-vanishing" : ""}`}
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
          <div className="absolute bottom-2 left-2 right-2 flex flex-wrap gap-1">
            {badges}
          </div>
        )}
        {actions && (
          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-end p-2 gap-1.5">
            {actions}
          </div>
        )}
      </div>
      <div className="p-3 space-y-1">
        <p className="text-sm font-medium leading-tight line-clamp-2 group-hover:text-foreground">{title}</p>
        {children}
      </div>
      <ProgressRing progress={progress} busy={busy} color={ringColor} />
    </div>
    </div>
  );
}
