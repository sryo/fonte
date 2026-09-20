"use client";

import { useRef, type KeyboardEvent } from "react";
import { isBrowsingHistory, stepHistory } from "@/lib/input-history";

/**
 * Up/Down recall over `entries` for a controlled composer. `onKeyDown`
 * returns true when it consumed the key.
 */
export function useInputHistory(
  entries: string[],
  value: string,
  setValue: (value: string) => void,
  enabled: boolean
) {
  const indexRef = useRef<number | null>(null);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!enabled || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey || e.nativeEvent.isComposing) return false;
    const next = stepHistory(entries, indexRef.current, value, e.key);
    if (!next) return false;
    e.preventDefault();
    if (e.key === "Escape") e.stopPropagation();
    indexRef.current = next.index;
    setValue(next.value);
    return true;
  };

  const isBrowsing = () => enabled && isBrowsingHistory(entries, indexRef.current, value);

  return { onKeyDown, isBrowsing };
}
