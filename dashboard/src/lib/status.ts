// Single source of truth mapping domain statuses (torrent, watchlist,
// subtitle) onto the six UI tones. Every status-colored surface — badges,
// callouts, progress rings, inline figures — reads from here.

export type Tone = "active" | "watch" | "done" | "warn" | "error" | "neutral";

const STATUS_TONE: Record<string, Tone> = {
  downloading: "active",
  translating: "active",
  adding: "active",
  watching: "watch",
  seeding: "done",
  completed: "done",
  fulfilled: "done",
  downloaded: "done",
  translated: "done",
  checking: "warn",
  stalled: "warn", // client-derived (use-stall-detection), not a server status
  error: "error",
  paused: "neutral",
  pending: "neutral",
  removed: "neutral",
};

export function statusTone(status: string): Tone {
  return STATUS_TONE[status] ?? "neutral";
}

export const TONE_TEXT: Record<Tone, string> = {
  active: "text-torrent",
  watch: "text-watchlist",
  done: "text-done",
  warn: "text-warning",
  error: "text-destructive",
  neutral: "text-muted-foreground",
};

export const TONE_BADGE: Record<Tone, string> = {
  active: "bg-torrent/15 text-torrent",
  watch: "bg-watchlist/15 text-watchlist",
  done: "bg-done/15 text-done",
  warn: "bg-warning/15 text-warning",
  error: "bg-destructive/15 text-destructive",
  neutral: "bg-muted text-muted-foreground",
};

/** Tone for a 0–100 release quality-match score. */
export function qualityTone(score: number): Tone {
  if (score >= 80) return "done";
  if (score >= 50) return "warn";
  return "error";
}
