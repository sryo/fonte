const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

export const RATE_LIMIT_RESET_MARGIN_MS = MINUTE_MS;
export const UNKNOWN_RESET_BACKOFF_MS = 15 * MINUTE_MS;
export const UNKNOWN_RESET_BACKOFF_MAX_MS = 2 * HOUR_MS;
export const RATE_LIMIT_MAX_PAUSED_MS = 12 * HOUR_MS;

export type RateLimitRetryPlan =
    | { action: 'requeue'; until: number; resetsAt?: number }
    | { action: 'dead-letter' };

/**
 * What to do with a message whose run hit a provider rate or usage limit:
 * hold it until just after the reset, or back off when the reset is unknown
 * (or already past), and give up once it has been held for over 12 hours.
 */
export function planRateLimitRetry(opts: {
    resetsAt?: number;
    now: number;
    pausedSoFarMs: number;
    consecutiveUnknown: number;
}): RateLimitRetryPlan {
    const { resetsAt, now, pausedSoFarMs, consecutiveUnknown } = opts;
    if (pausedSoFarMs > RATE_LIMIT_MAX_PAUSED_MS) return { action: 'dead-letter' };
    if (resetsAt !== undefined && resetsAt > now) {
        return { action: 'requeue', until: resetsAt + RATE_LIMIT_RESET_MARGIN_MS, resetsAt };
    }
    const backoff = Math.min(UNKNOWN_RESET_BACKOFF_MS * 2 ** Math.max(0, consecutiveUnknown), UNKNOWN_RESET_BACKOFF_MAX_MS);
    return { action: 'requeue', until: now + backoff };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** HH:MM in the process's time zone, plus the date when it isn't `now`'s day. */
function formatLocalTime(at: number, now: number): string {
    const date = new Date(at);
    const today = new Date(now);
    const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    if (date.toDateString() === today.toDateString()) return time;
    const day = date.toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
    });
    return `${time} on ${day}`;
}

/** The chat and channel note for a paused message. A known reset is shown as the reset itself, not the margin after it. */
export function formatPauseNotice(opts: { providerLabel: string; until: number; resetsAt?: number; now?: number }): string {
    const now = opts.now ?? Date.now();
    if (opts.resetsAt !== undefined) {
        return `Paused until ${formatLocalTime(opts.resetsAt, now)}. ${opts.providerLabel}'s usage limit resets then.`;
    }
    return `Paused until ${formatLocalTime(opts.until, now)}. ${opts.providerLabel} is rate limiting, so I'll try again then.`;
}
