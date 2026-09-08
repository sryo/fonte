"use client";

import { useMemo } from "react";
import { bandGrid, downsamplePieces } from "@/lib/pieces";
import { cn } from "@/lib/utils";

// A cell averages many pieces, so a lone held piece would land near zero opacity.
// Quantizing keeps every partial cell a legible blue and avoids blending the
// unreachable red into it.
const BLUE_STEPS = [0.3, 0.5, 0.72, 0.9];

function blueStep(fraction: number): number {
  return BLUE_STEPS[Math.min(BLUE_STEPS.length - 1, Math.ceil(fraction * BLUE_STEPS.length) - 1)];
}

export function PiecesBand({
  bitfield,
  unavailable,
  count,
  done,
  stalled = false,
  label,
}: {
  bitfield: string;
  unavailable?: string | null;
  count: number;
  done: boolean;
  stalled?: boolean;
  label?: string;
}) {
  const { cells: cellCount, cols } = useMemo(() => bandGrid(count), [count]);
  const cells = useMemo(() => downsamplePieces(bitfield, count, cellCount), [bitfield, count, cellCount]);
  const missing = useMemo(
    () => (unavailable && !done ? downsamplePieces(unavailable, count, cellCount) : null),
    [unavailable, count, done, cellCount],
  );

  return (
    <div
      role="img"
      aria-label={label}
      className="grid w-full gap-0.5"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {cells.map((fraction, i) => {
        const gone = missing?.[i] ?? 0;
        let color: string | null = null;
        let opacity = 1;
        if (done || fraction >= 1) {
          color = "bg-done";
        } else if (gone > 0 && gone >= fraction) {
          color = "bg-unavailable";
          opacity = gone < 0.5 ? 0.55 : 1;
        } else if (fraction > 0) {
          color = "bg-torrent";
          opacity = blueStep(fraction) * (stalled ? 0.75 : 1);
        }
        return (
          <div key={i} className="relative aspect-square overflow-hidden rounded-[2px] bg-muted">
            {color && (
              <div className={cn("absolute inset-0 transition-opacity duration-250", color)} style={{ opacity }} />
            )}
          </div>
        );
      })}
    </div>
  );
}
