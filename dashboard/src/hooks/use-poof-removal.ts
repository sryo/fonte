"use client";

import { useCallback, useRef, useState } from "react";

// Staggered dust-poof exit animation for card removal.
export function usePoofRemoval(refetch: () => void | Promise<unknown>) {
  // id → stagger delay (ms) for cards currently playing the poof-out animation
  const [exitingIds, setExitingIds] = useState<Map<string, number>>(new Map());

  // Ids removed (or mid-poof) that polling must not resurrect: an in-flight
  // poll response fetched before the server-side delete can land after the
  // exiting state clears, flashing the card back for a tick.
  const hiddenIdsRef = useRef<Set<string>>(new Set());

  /** Drop hidden ids from a freshly polled list before it reaches state. */
  const filterHidden = useCallback(<T extends { id: string }>(items: T[]): T[] => {
    const hidden = hiddenIdsRef.current;
    return hidden.size ? items.filter((item) => !hidden.has(item.id)) : items;
  }, []);

  /** Returns the ids whose delete failed; those are unhidden again. */
  const removeAll = useCallback(
    async (ids: string[], remove: (id: string) => Promise<unknown>) => {
      const settled = await Promise.allSettled(ids.map((id) => remove(id)));
      // A failed delete resurfaces its card instead of silently vanishing it
      return ids.filter((id, i) => {
        if (settled[i].status !== "rejected") return false;
        hiddenIdsRef.current.delete(id);
        return true;
      });
    },
    [],
  );

  // Cards stay mounted for the animation's duration so it runs before they
  // leave the DOM. Honours reduced-motion.
  const poofThenRemove = useCallback(
    (ids: string[], remove: (id: string) => Promise<unknown>) => {
      if (ids.length === 0) return;
      const reduce =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce) {
        ids.forEach((id) => hiddenIdsRef.current.add(id));
        removeAll(ids, remove).then(() => refetch());
        return;
      }
      // Clamp total stagger to ~900ms so a big "Clear" never drags on.
      const stagger = ids.length > 1 ? Math.min(70, 900 / (ids.length - 1)) : 0;
      setExitingIds((prev) => {
        const next = new Map(prev);
        ids.forEach((id, i) => next.set(id, Math.round(i * stagger)));
        return next;
      });
      const maxDelay = Math.round((ids.length - 1) * stagger);
      window.setTimeout(async () => {
        // Hide only now: while the poof plays the items still exist
        // server-side, so polls must keep returning them or the cards
        // unmount mid-animation. Hiding before the delete still prevents
        // an in-flight poll from resurrecting them afterwards.
        ids.forEach((id) => hiddenIdsRef.current.add(id));
        const failedIds = await removeAll(ids, remove);
        if (failedIds.length) {
          setExitingIds((prev) => {
            const next = new Map(prev);
            failedIds.forEach((id) => next.delete(id));
            return next;
          });
        }
        // The currently rendered list was fetched before the delete, so the
        // exiting state must outlive it: clearing before the refreshed list
        // lands flashes the card back at full size for the round-trip.
        await refetch();
        setExitingIds((prev) => {
          const next = new Map(prev);
          ids.forEach((id) => next.delete(id));
          return next;
        });
      }, maxDelay + 560);
    },
    [refetch, removeAll],
  );

  return { exitingIds, poofThenRemove, filterHidden };
}
