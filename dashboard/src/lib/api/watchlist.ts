import type {
  WatchlistStatus, MediaType, WatchlistRecord, WatchlistResultRecord,
} from "../api-types";
import { apiFetch } from "./client";

// ── Watchlist ────────────────────────────────────────────────────────────

export async function getWatchlist(status?: WatchlistStatus): Promise<{ ok: boolean; entries: WatchlistRecord[] }> {
  const params = status ? `?status=${status}` : "";
  return apiFetch(`/api/watchlist${params}`);
}

export async function getWatchlistEntry(id: string): Promise<{ ok: boolean; entry: WatchlistRecord; results: WatchlistResultRecord[] }> {
  return apiFetch(`/api/watchlist/${encodeURIComponent(id)}`);
}

export async function addWatchlistEntry(data: { title: string; mediaType: MediaType; year?: number; quality?: string; seasonPattern?: string }): Promise<{ ok: boolean; entry: WatchlistRecord }> {
  return apiFetch("/api/watchlist", { method: "POST", body: JSON.stringify(data) });
}

// year/seasonPattern/posterUrl accept null to clear the stored value
// (undefined is dropped by JSON.stringify, so the server would skip them).
export async function updateWatchlistEntry(
  id: string,
  data: Partial<Omit<WatchlistRecord, "year" | "seasonPattern" | "posterUrl">> & {
    year?: number | null;
    seasonPattern?: string | null;
    posterUrl?: string | null;
  },
): Promise<{ ok: boolean; entry: WatchlistRecord }> {
  return apiFetch(`/api/watchlist/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(data) });
}

export async function deleteWatchlistEntry(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/watchlist/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function triggerWatchlistSearch(id: string): Promise<{ ok: boolean; results: WatchlistResultRecord[] }> {
  return apiFetch(`/api/watchlist/${encodeURIComponent(id)}/search`, { method: "POST" });
}

export async function triggerWatchlistCheck(): Promise<{ ok: boolean }> {
  return apiFetch("/api/watchlist/check", { method: "POST" });
}

export async function addWatchlistResult(watchlistId: string, resultId: number): Promise<{ ok: boolean }> {
  return apiFetch(`/api/watchlist/${encodeURIComponent(watchlistId)}/results/${resultId}/add`, { method: "POST" });
}

export async function markWatchlistResultsViewed(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/watchlist/${encodeURIComponent(id)}/results/viewed`, { method: "POST" });
}
