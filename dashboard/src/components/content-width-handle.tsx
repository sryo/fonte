"use client";

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { cn } from "@/lib/utils";

export const CONTENT_W_DEFAULT = 1152;
export const CONTENT_W_MIN = 768;
export const CONTENT_W_MAX = 2400;
const EDGE_MARGIN = 24;
const DRAG_THRESHOLD_PX = 3;

function useViewportWidth() {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const update = () => setWidth(window.innerWidth);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return width;
}

/** Hover-revealed hairline in the gutter at the content boundary: drag it to
    set the global content max-width, double-click to reset. During the drag
    the CSS var is written straight to the shell root (no React re-renders);
    the persisted state commits on release. Renders nothing when the viewport
    leaves no gutter to grab. */
export function ContentWidthHandle({
  side,
  width,
  setWidth,
  scrollRef,
}: {
  side: "left" | "right";
  width: number;
  setWidth: (n: number) => void;
  scrollRef: RefObject<HTMLElement | null>;
}) {
  const dragRef = useRef<{
    startX: number;
    startWidth: number;
    maxW: number;
    root: HTMLElement | null;
    last: number;
    started: boolean;
  } | null>(null);
  const viewportW = useViewportWidth();
  if (viewportW < width + 2 * EDGE_MARGIN) return null;

  const apply = (root: HTMLElement | null, next: number) =>
    root?.style.setProperty("--content-max-w", `${next}px`);

  return (
    <div
      role="presentation"
      title="Drag to set content width. Double-click to reset."
      className={cn(
        "group/cwh absolute inset-y-0 z-10 w-3 cursor-col-resize",
        side === "right"
          ? "right-[calc((100%-var(--content-max-w))/2-6px)]"
          : "left-[calc((100%-var(--content-max-w))/2-6px)]"
      )}
      onWheel={(e) => scrollRef.current?.scrollBy({ top: e.deltaY, left: e.deltaX })}
      onDoubleClick={(e) => {
        e.preventDefault();
        setWidth(CONTENT_W_DEFAULT);
      }}
      onPointerDown={(e: ReactPointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        dragRef.current = {
          startX: e.clientX,
          startWidth: width,
          last: width,
          started: false,
          maxW: Math.min(CONTENT_W_MAX, window.innerWidth - 2 * EDGE_MARGIN),
          root: e.currentTarget.closest<HTMLElement>("[data-content-root]"),
        };
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* synthetic pointer events have no capturable id */
        }
        e.currentTarget.setAttribute("data-dragging", "");
      }}
      onPointerMove={(e) => {
        e.currentTarget.style.setProperty("--cwh-glow-y", `${e.nativeEvent.offsetY}px`);
        const drag = dragRef.current;
        if (!drag) return;
        const dx = e.clientX - drag.startX;
        if (!drag.started) {
          if (Math.abs(dx) < DRAG_THRESHOLD_PX) return;
          drag.started = true;
        }
        // 2x because the container is centered: both gutters shrink together,
        // which makes the dragged edge follow the pointer exactly.
        const signed = side === "right" ? dx : -dx;
        const next = Math.round(
          Math.min(drag.maxW, Math.max(CONTENT_W_MIN, drag.startWidth + 2 * signed))
        );
        drag.last = next;
        apply(drag.root, next);
      }}
      onPointerUp={(e) => {
        e.currentTarget.removeAttribute("data-dragging");
        const drag = dragRef.current;
        if (!drag) return;
        dragRef.current = null;
        setWidth(drag.last);
      }}
      onPointerCancel={(e) => {
        e.currentTarget.removeAttribute("data-dragging");
        const drag = dragRef.current;
        if (!drag) return;
        dragRef.current = null;
        setWidth(drag.last);
      }}
    >
      <span className="pointer-events-none absolute inset-y-3 left-1/2 w-px -translate-x-1/2 bg-border opacity-0 transition-opacity duration-150 group-hover/cwh:opacity-100 group-data-[dragging]/cwh:opacity-100 motion-reduce:transition-none" />
      <span
        className="content-width-glow pointer-events-none absolute left-1/2 h-28 w-[3px] -translate-x-1/2 -translate-y-1/2 opacity-0 transition-opacity duration-150 group-hover/cwh:opacity-100 group-data-[dragging]/cwh:opacity-100 motion-reduce:transition-none"
        style={{ top: "var(--cwh-glow-y, 50%)" }}
      />
    </div>
  );
}
