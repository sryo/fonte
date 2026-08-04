"use client";

import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * Drives a sliding active-item indicator (tab underline, filter-pill thumb)
 * by measuring the item marked data-indicator-key={activeKey} inside the
 * container. Active-key changes tween; first paint, font load, resizes, and
 * item-set changes reposition with the transition suspended so the indicator
 * never animates in from a stale spot. The container gets `data-sliding`
 * once positioned, letting static active styles (the no-JS fallback) be
 * suppressed via group-data-[sliding]:.
 */
export function useSlidingIndicator<I extends HTMLElement>(
  activeKey: string,
  /** Changes whenever the measurable item set changes (e.g. pills auto-hiding). */
  layoutKey = "",
  /** Match the active item's full box (height and y), not just x/width. */
  fullSize = false
) {
  const indicatorRef = useRef<I | null>(null);
  const boxRef = useRef<HTMLElement | null>(null);
  const activeRef = useRef(activeKey);
  const positioned = useRef(false);
  const teardown = useRef<(() => void) | undefined>(undefined);

  const position = useCallback(
    (animate: boolean) => {
      const box = boxRef.current;
      const ind = indicatorRef.current;
      if (!box || !ind) return;
      const el = box.querySelector<HTMLElement>(
        `[data-indicator-key="${CSS.escape(activeRef.current)}"]`
      );
      if (!el) {
        ind.style.opacity = "0";
        return;
      }
      const instant = !animate || !positioned.current;
      if (instant) ind.style.transition = "none";
      ind.style.opacity = "1";
      ind.style.width = `${el.offsetWidth}px`;
      if (fullSize) {
        ind.style.height = `${el.offsetHeight}px`;
        ind.style.transform = `translate(${el.offsetLeft}px, ${el.offsetTop}px)`;
      } else {
        ind.style.transform = `translateX(${el.offsetLeft}px)`;
      }
      if (instant) {
        void ind.offsetWidth;
        ind.style.transition = "";
      }
      positioned.current = true;
      box.dataset.sliding = "";
    },
    [fullSize]
  );

  // Callback ref so containers that mount after a loading state still get
  // measured and observed the moment they attach.
  const containerRef = useCallback(
    (node: HTMLElement | null) => {
      teardown.current?.();
      teardown.current = undefined;
      boxRef.current = node;
      positioned.current = false;
      if (!node) return;
      const observer = new ResizeObserver(() => position(false));
      observer.observe(node);
      let cancelled = false;
      document.fonts?.ready.then(() => {
        if (!cancelled) position(false);
      });
      teardown.current = () => {
        cancelled = true;
        observer.disconnect();
      };
      position(false);
    },
    [position]
  );

  useLayoutEffect(() => {
    activeRef.current = activeKey;
    position(true);
  }, [activeKey, position]);

  useLayoutEffect(() => {
    position(false);
  }, [layoutKey, position]);

  useLayoutEffect(() => () => teardown.current?.(), []);

  return { containerRef, indicatorRef };
}
