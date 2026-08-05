// Pure ordering for the home watchlist lane.
// Imports stay relative (no "@/") so the root vitest run can resolve them.

import type { WatchlistRecord } from "./api-types";

// Unreviewed finds jump the front; paused sink; fulfilled settle at the end
// until cleared.
export function watchRank(w: WatchlistRecord): number {
  if (w.status === "fulfilled") return 3;
  if (w.status === "paused") return 2;
  return (w.newResultsCount ?? 0) > 0 ? 0 : 1;
}

export function watchOrder(entries: WatchlistRecord[]): WatchlistRecord[] {
  return [...entries].sort((a, b) => watchRank(a) - watchRank(b) || a.id.localeCompare(b.id));
}
