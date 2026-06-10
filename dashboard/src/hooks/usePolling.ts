import { useEffect } from "react";

export function usePolling(fn: () => void, intervalMs: number) {
  useEffect(() => {
    fn();
    const interval = setInterval(fn, intervalMs);
    return () => clearInterval(interval);
  }, [fn, intervalMs]);
}
