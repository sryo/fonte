"use client";

import { useEffect, useState } from "react";
import { STATUS_DELAY_MS, STATUS_MIN_MS, nextDelayedFlagTimer } from "@/lib/delayed-flag";

/** True once `active` has held for the delay, then stays true for at least the minimum. */
export function useDelayedFlag(active: boolean, delayMs = STATUS_DELAY_MS, minMs = STATUS_MIN_MS): boolean {
  const [shownAt, setShownAt] = useState<number | null>(null);

  useEffect(() => {
    const timer = nextDelayedFlagTimer({ active, shownAt, now: Date.now() }, { delayMs, minMs });
    if (!timer) return;
    const id = setTimeout(() => setShownAt(timer.show ? Date.now() : null), timer.afterMs);
    return () => clearTimeout(id);
  }, [active, shownAt, delayMs, minMs]);

  return shownAt != null;
}
