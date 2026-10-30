export const STATUS_DELAY_MS = 400;
export const STATUS_MIN_MS = 400;

export function nextDelayedFlagTimer(
  { active, shownAt, now }: { active: boolean; shownAt: number | null; now: number },
  { delayMs, minMs }: { delayMs: number; minMs: number }
): { afterMs: number; show: boolean } | null {
  if (active && shownAt == null) return { afterMs: delayMs, show: true };
  if (!active && shownAt != null) return { afterMs: Math.max(0, shownAt + minMs - now), show: false };
  return null;
}
