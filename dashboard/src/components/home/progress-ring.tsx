"use client";

import React from "react";
// Progress & status UI conventions: ../ui/README.md
import { cn, type DomainColor } from "@/lib/utils";

export type RingColor = DomainColor;

export function ProgressRing({
  progress,
  busy,
  color = "torrent",
  complete,
}: {
  progress?: { value: number; stalled?: boolean };
  busy?: boolean;
  color?: RingColor;
  complete?: boolean;
}) {
  if (complete) return <div aria-hidden className="progress-ring progress-ring--complete" />;
  const indeterminate = !progress && busy;
  if (!progress && !busy) return null;
  if (progress && progress.value >= 1) return null;
  const style: React.CSSProperties = {
    ["--ring-color" as string]: `var(--${color})`,
  };
  if (progress) {
    const value = Number.isFinite(progress.value)
      ? Math.min(1, Math.max(0, progress.value))
      : 0;
    (style as Record<string, string | number>)["--progress"] = value;
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
