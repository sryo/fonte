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
  label,
}: {
  bitfield: string;
  unavailable?: string | null;
  count: number;
  done: boolean;
  label?: string;
}) {
  const cells = useMemo(() => downsamplePieces(bitfield, count, CELLS), [bitfield, count]);
  const stuck = useMemo(
    () => (unavailable && !done ? downsamplePieces(unavailable, count, CELLS) : null),
    [unavailable, count, done],
  );

  return (
    <div
      role="img"
      aria-label={label}
      className="grid w-full grid-cols-[repeat(36,minmax(0,1fr))] gap-0.5"
    >
      {cells.map((fraction, i) => (
        <div key={i} className="relative aspect-square overflow-hidden rounded-[2px] bg-muted">
          {stuck && stuck[i] > 0 && (
            <div className="absolute inset-0 bg-warning transition-opacity duration-250" style={{ opacity: stuck[i] * 0.5 }} />
          )}
          <div
            className={cn("absolute inset-0 transition-opacity duration-250", done ? "bg-done" : "bg-torrent")}
            style={{ opacity: done ? 1 : fraction }}
          />
        </div>
      ))}
    </div>
  );
}
