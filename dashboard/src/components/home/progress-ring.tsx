"use client";

import React from "react";
import { cn } from "@/lib/utils";

export type RingColor = "torrent" | "watchlist" | "automation";

export function ProgressRing({
  progress,
  busy,
  color = "torrent",
}: {
  progress?: { value: number; stalled?: boolean };
  busy?: boolean;
  color?: RingColor;
}) {
  const indeterminate = !progress && busy;
  if (!progress && !busy) return null;
  if (progress && progress.value >= 1) return null;
  const style: React.CSSProperties = {
    ["--ring-color" as string]: `var(--${color})`,
  };
  if (progress) {
    (style as Record<string, string | number>)["--progress"] = Math.min(1, Math.max(0, progress.value));
  }
  return (
    <div
      aria-hidden
      className={cn(
        "progress-ring",
        progress?.stalled && "progress-ring--stalled",
        indeterminate && "progress-ring--indeterminate",
      )}
      style={style}
    />
  );
}
