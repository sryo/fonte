"use client";

import { type ReactNode } from "react";
import { stackTilt, type StackDepth } from "@/lib/stack-visual";

/**
 * Renders a card on top of a slightly disordered pile of ghost cards —
 * "several things await" without showing them. Depth 0 adds no DOM.
 */
export function CardStack({
  depth,
  seed,
  children,
}: {
  depth: StackDepth;
  seed: string;
  children: ReactNode;
}) {
  if (depth === 0) return <>{children}</>;
  return (
    <div className="relative isolate">
      {Array.from({ length: depth }, (_, layer) => {
        const { angle, dx, dy } = stackTilt(seed, layer);
        return (
          <div
            key={layer}
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 origin-bottom rounded-xl border border-border/60 bg-card shadow-card transition-transform duration-300"
            style={{ transform: `translate(${dx}px, ${dy}px) rotate(${angle}deg)` }}
          />
        );
      })}
      {children}
    </div>
  );
}
