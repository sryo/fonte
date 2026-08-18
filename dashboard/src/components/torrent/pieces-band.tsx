"use client";

import { useMemo } from "react";
import { downsamplePieces } from "@/lib/pieces";
import { cn } from "@/lib/utils";

const CELLS = 144;

export function PiecesBand({
  bitfield,
  count,
  done,
  label,
}: {
  bitfield: string;
  count: number;
  done: boolean;
  label?: string;
}) {
  const cells = useMemo(() => downsamplePieces(bitfield, count, CELLS), [bitfield, count]);

  return (
    <div
      role="img"
      aria-label={label}
      className="grid w-full grid-cols-[repeat(36,minmax(0,1fr))] gap-0.5"
    >
      {cells.map((fraction, i) => (
        <div key={i} className="relative aspect-square overflow-hidden rounded-[2px] bg-muted">
          <div
            className={cn("absolute inset-0 transition-opacity duration-250", done ? "bg-done" : "bg-torrent")}
            style={{ opacity: done ? 1 : fraction }}
          />
        </div>
      ))}
    </div>
  );
}
