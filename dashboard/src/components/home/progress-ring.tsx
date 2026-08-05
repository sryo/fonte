"use client";

import React from "react";
// Progress & status UI conventions: ../ui/README.md
import { cn, type DomainColor } from "@/lib/utils";

export type RingColor = DomainColor;

export function ProgressRing({
  progress,
  busy,
  color,
  complete,
  className,
}: {
  progress?: { value: number; stalled?: boolean };
  busy?: boolean;
  color?: RingColor;
  /** Full ring: true shines (live activity), "still" waits (no shine). */
  complete?: boolean | "still";
  /** Scale modifier only (e.g. "progress-ring--mini"), never ad-hoc sizing. */
  className?: string;
}) {
  if (complete && !busy)
    return (
      <div
        aria-hidden
        className={cn(
          "progress-ring progress-ring--complete",
          complete === "still" && "progress-ring--still",
          className
        )}
        style={color ? { ["--ring-color" as string]: `var(--${color})` } : undefined}
      />
    );
  const indeterminate = !progress && busy;
  if (!progress && !busy) return null;
  if (progress && progress.value >= 1) return null;
  const style: React.CSSProperties = {
    ["--ring-color" as string]: `var(--${color ?? "torrent"})`,
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
        className,
      )}
      style={style}
    />
  );
}
