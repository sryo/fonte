"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { moveId } from "@/lib/torrent-order";

const DRAG_THRESHOLD_PX = 8;

export interface QueueDragOptions {
  /** Ids in the order currently rendered (the active sort, filtered). */
  visibleIds: string[];
  /** The same ids in queue order — what the row morphs into on pickup. */
  queueIds: string[];
  canDrag: (id: string) => boolean;
  /** View-transition-wrapped state update (home's withMorph). */
  withMorph: (update: () => void) => void;
  /** Home poll gate — held true from pickup; the commit handler releases it. */
  pollPausedRef: { current: boolean };
  /** Drop handler: dragged id, its index in orderedIds, and the full visible queue order. */
  onCommit: (id: string, index: number, orderedIds: string[]) => void;
}

interface DragState {
  id: string;
  el: HTMLElement;
  startX: number;
  startY: number;
  grabX: number;
  grabY: number;
  armed: boolean;
  lastX: number;
  lastY: number;
}

/**
 * Reorder-by-drag for the Downloads row. Picking a card up morphs the row
 * into true queue order (revealing the queue exactly while your hand is
 * full); mid-drag slot changes reorder instantly; the drop hands the final
 * order to onCommit, which restores the user's sort. Clicks under the 8px
 * threshold still navigate.
 */
export function useQueueDrag(options: QueueDragOptions) {
  const [order, setOrder] = useState<string[] | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const dragRef = useRef<DragState | null>(null);
  const orderRef = useRef<string[] | null>(null);
  const translateRef = useRef({ x: 0, y: 0 });
  const wrapperEls = useRef(new Map<string, HTMLElement>());

  const registerWrapper = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      if (el) wrapperEls.current.set(id, el);
      else wrapperEls.current.delete(id);
    },
    []
  );

  const applyOrder = useCallback((next: string[] | null) => {
    orderRef.current = next;
    setOrder(next);
  }, []);

  const startRef = useRef<(id: string, e: PointerEvent, el: HTMLElement) => void>(() => {});

  useEffect(() => {
    const swallowClick = (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
    };

    // Keeps the grab point glued to the pointer across slot reorders: the
    // slot origin is re-derived each time as rect minus the applied translate.
    const track = (clientX: number, clientY: number) => {
      const d = dragRef.current;
      if (!d) return;
      const rect = d.el.getBoundingClientRect();
      const slotLeft = rect.left - translateRef.current.x;
      const slotTop = rect.top - translateRef.current.y;
      const x = clientX - d.grabX - slotLeft;
      const y = clientY - d.grabY - slotTop;
      translateRef.current = { x, y };
      d.el.style.translate = `${x}px ${y}px`;
    };

    const cleanup = () => {
      const d = dragRef.current;
      if (d) {
        d.el.style.translate = "";
      }
      dragRef.current = null;
      translateRef.current = { x: 0, y: 0 };
      setDraggingId(null);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
    };

    const cancel = () => {
      const d = dragRef.current;
      const opts = optionsRef.current;
      if (d?.armed) {
        opts.withMorph(() => applyOrder(null));
        opts.pollPausedRef.current = false;
      }
      cleanup();
    };

    const arm = (d: DragState) => {
      const opts = optionsRef.current;
      d.armed = true;
      const rect = d.el.getBoundingClientRect();
      d.grabX = d.startX - rect.left;
      d.grabY = d.startY - rect.top;
      opts.pollPausedRef.current = true;
      setDraggingId(d.id);
      document.body.style.cursor = "grabbing";
      document.body.style.userSelect = "none";
      const queueIds = [...opts.queueIds];
      const sameOrder =
        queueIds.length === opts.visibleIds.length &&
        queueIds.every((id, i) => id === opts.visibleIds[i]);
      if (sameOrder) applyOrder(queueIds);
      else opts.withMorph(() => applyOrder(queueIds));
    };

    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      d.lastX = e.clientX;
      d.lastY = e.clientY;
      if (!d.armed) {
        if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD_PX) return;
        arm(d);
      }
      track(e.clientX, e.clientY);

      const ids = orderRef.current;
      if (!ids) return;
      const from = ids.indexOf(d.id);
      let best = from;
      let bestDist = Infinity;
      ids.forEach((id, i) => {
        const el = wrapperEls.current.get(id);
        if (!el) return;
        const r = el.getBoundingClientRect();
        // The dragged card's own slot is its rect minus the live translate.
        const dx = id === d.id ? translateRef.current.x : 0;
        const dy = id === d.id ? translateRef.current.y : 0;
        const cx = r.left - dx + r.width / 2;
        const cy = r.top - dy + r.height / 2;
        const dist = Math.hypot(e.clientX - cx, e.clientY - cy);
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      });
      if (best !== from) {
        applyOrder(moveId(ids, from, best));
        // Re-anchor after React commits the new slot geometry.
        requestAnimationFrame(() => track(d.lastX, d.lastY));
      }
    };

    const onUp = () => {
      const d = dragRef.current;
      if (!d) return;
      if (!d.armed) {
        cleanup();
        return;
      }
      // The pointerup's trailing click would navigate the dropped card.
      window.addEventListener("click", swallowClick, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallowClick, { capture: true }), 0);

      const ids = orderRef.current;
      const opts = optionsRef.current;
      cleanup();
      if (!ids) {
        opts.pollPausedRef.current = false;
        return;
      }
      opts.onCommit(d.id, ids.indexOf(d.id), ids);
    };

    const onCancel = () => cancel();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };

    const start = (id: string, e: PointerEvent, el: HTMLElement) => {
      dragRef.current = {
        id,
        el,
        startX: e.clientX,
        startY: e.clientY,
        grabX: 0,
        grabY: 0,
        armed: false,
        lastX: e.clientX,
        lastY: e.clientY,
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("keydown", onKey);
    };

    startRef.current = start;
    return cleanup;
  }, [applyOrder]);

  const onPointerDown = useCallback(
    (id: string) => (e: React.PointerEvent<HTMLElement>) => {
      const opts = optionsRef.current;
      if (e.button !== 0 || dragRef.current) return;
      if (opts.visibleIds.length < 2 || !opts.canDrag(id)) return;
      if ((e.target as HTMLElement).closest("button, a, input, [data-no-drag]")) return;
      startRef.current(id, e.nativeEvent, e.currentTarget);
    },
    []
  );

  /** Called by the commit handler once optimistic state covers the new order. */
  const clearOrder = useCallback(() => applyOrder(null), [applyOrder]);

  return { order, draggingId, onPointerDown, registerWrapper, clearOrder };
}
