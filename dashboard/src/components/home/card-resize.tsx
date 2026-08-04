"use client";

import {
  createContext,
  useContext,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Notches } from "@phosphor-icons/react";
import { CONTENT_PAD, cardSnapCandidates, snapStep } from "@/lib/grid-snap";

export const CARD_SIZE_MIN = 120;
export const CARD_SIZE_MAX = 360;
export const CARD_SIZE_COMPACT_BELOW = 140;

const CardSizeContext = createContext<{
  size: number;
  setSize: (n: number) => void;
} | null>(null);

export function CardSizeProvider({
  size,
  setSize,
  children,
}: {
  size: number;
  setSize: (n: number) => void;
  children: ReactNode;
}) {
  return <CardSizeContext.Provider value={{ size, setSize }}>{children}</CardSizeContext.Provider>;
}

/** Finder-style corner grip: drag any card's corner to resize the whole grid.
    During the drag the CSS var is written straight to the grid root (no React
    re-renders); the persisted state commits on release. Renders nothing when
    no provider is above (cards reused outside home). */
export function CardResizeHandle() {
  const ctx = useContext(CardSizeContext);
  const dragRef = useRef<{
    startX: number;
    startSize: number;
    root: HTMLElement | null;
    last: number;
    candidates: number[];
    snapped: number | null;
  } | null>(null);
  if (!ctx) return null;

  const apply = (root: HTMLElement | null, next: number) => {
    if (!root) return;
    root.style.setProperty("--card-w", `${next}px`);
    if (next < CARD_SIZE_COMPACT_BELOW) root.setAttribute("data-cards", "compact");
    else root.removeAttribute("data-cards");
  };

  return (
    <span
      role="presentation"
      title="Drag to resize cards. ⌥ disables snapping."
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e: ReactPointerEvent<HTMLSpanElement>) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const root = e.currentTarget.closest<HTMLElement>("[data-cards-root]");
        dragRef.current = {
          startX: e.clientX,
          startSize: ctx.size,
          root,
          last: ctx.size,
          candidates: root
            ? cardSnapCandidates(root.clientWidth - CONTENT_PAD, CARD_SIZE_MIN, CARD_SIZE_MAX)
            : [],
          snapped: null,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const drag = dragRef.current;
        if (!drag) return;
        const raw = Math.min(CARD_SIZE_MAX, Math.max(CARD_SIZE_MIN, drag.startSize + (e.clientX - drag.startX)));
        let next: number;
        if (e.altKey) {
          next = Math.round(raw);
          drag.snapped = null;
        } else {
          const step = snapStep(raw, drag.candidates, drag.snapped, 6, 10);
          drag.snapped = step.latched;
          next = step.latched === null ? Math.round(step.value) : step.value;
        }
        drag.last = next;
        apply(drag.root, next);
        if (drag.snapped !== null) e.currentTarget.setAttribute("data-snapped", "");
        else e.currentTarget.removeAttribute("data-snapped");
      }}
      onPointerUp={(e) => {
        e.currentTarget.removeAttribute("data-snapped");
        const drag = dragRef.current;
        if (!drag) return;
        dragRef.current = null;
        ctx.setSize(drag.last);
      }}
      onPointerCancel={(e) => {
        e.currentTarget.removeAttribute("data-snapped");
        const drag = dragRef.current;
        if (!drag) return;
        dragRef.current = null;
        ctx.setSize(drag.last);
      }}
      className="absolute bottom-1 right-1 z-10 hidden h-6 w-6 cursor-nwse-resize items-center justify-center rounded text-muted-foreground/50 hover:text-muted-foreground data-[snapped]:text-foreground group-hover:flex"
    >
      <Notches className="h-3 w-3" weight="bold" />
    </span>
  );
}
