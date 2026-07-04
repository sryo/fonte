"use client";

import { useCallback, useEffect, useState } from "react";

// localStorage-backed state. Initializes with the default and reads storage in
// a mount effect so SSR markup stays stable (same pattern as indexer-banner);
// the stored value lands one frame after hydration.
export function usePersistedState<T>(
  key: string,
  defaultValue: T,
  isValid: (v: unknown) => v is T,
): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(defaultValue);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return;
      const parsed: unknown = JSON.parse(raw);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration read; SSR markup must render the default first
      if (isValid(parsed)) setValue(parsed);
    } catch {
      /* corrupt entry — keep the default */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const setAndPersist = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        if (typeof window !== "undefined") {
          try {
            localStorage.setItem(key, JSON.stringify(resolved));
          } catch {
            /* storage full/blocked — state still updates in memory */
          }
        }
        return resolved;
      });
    },
    [key],
  );

  return [value, setAndPersist];
}
