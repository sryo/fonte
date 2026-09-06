"use client";

import { useMemo } from "react";
import { downsamplePieces } from "@/lib/pieces";
import { cn } from "@/lib/utils";

const CELLS = 144;

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
  const cells = useMemo(() => downsamplePieces(bitfield, count, CELLS), [bitfield, count]);
  const hollow = useMemo(
    () => (unavailable && !done ? downsamplePieces(unavailable, count, CELLS) : null),
    [unavailable, count, done],
  );

  return (
    <div
      role="img"
      aria-label={label}
      className="grid w-full grid-cols-[repeat(36,minmax(0,1fr))] gap-0.5"
    >
      {cells.map((fraction, i) => {
        const missing = hollow?.[i] ?? 0;
        return (
          <div key={i} className="relative aspect-square overflow-hidden rounded-[2px] bg-muted">
            {missing > 0 && (
              <div
                className="absolute inset-0 rounded-[2px] text-ghost transition-opacity duration-250"
                style={{ opacity: missing, boxShadow: "inset 0 0 0 1px currentColor" }}
              />
            )}
            <div
              className={cn("absolute inset-0 transition-opacity duration-250", done ? "bg-done" : "bg-torrent")}
              style={{ opacity: done ? 1 : fraction * (stalled ? 0.5 : 1) }}
            />
          </div>
        );
      })}
    </div>
  );
}
