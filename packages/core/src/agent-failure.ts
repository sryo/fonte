import { redactSecretText } from './secrets';

export type AgentFailureKind = 'auth' | 'rate_limit' | 'billing' | 'stalled' | 'unknown';

/** What the stall watchdog says when it stops a silent run; `classifyAgentFailure` keys on it. */
export function stalledRunMessage(command: string, silentFor: string): string {
    return `${command} produced no output for ${silentFor}, so it was stopped`;
}

const AUTH_RE = /oauth session expired|failed to authenticate|not (?:logged in|authenticated)|invalid (?:api[ _-]?key|x-api-key|bearer token|credentials)|authentication[_ ]error|\b401\b|unauthorized|run \/login|api key (?:is )?(?:invalid|missing|required)/i;
const BILLING_RE = /credit balance|insufficient (?:funds|credits|quota)|billing|payment required|\b402\b|quota exceeded/i;
const RATE_RE = /rate[_ ]limit|\b429\b|too many requests|overloaded|usage limit|limit reached|(?:hit|reached) your [^.\n·]{0,40}limit/i;
const STALLED_RE = /produced no output for .+, so it was stopped/;

export function classifyAgentFailure(text: string): AgentFailureKind {
    if (STALLED_RE.test(text)) return 'stalled';
    if (AUTH_RE.test(text)) return 'auth';
    if (BILLING_RE.test(text)) return 'billing';
    if (RATE_RE.test(text)) return 'rate_limit';
    return 'unknown';
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAY_MS = 86_400_000;

function wallClockParts(t: number, timeZone: string) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    }).formatToParts(new Date(t));
    const get = (type: string) => Number(parts.find(p => p.type === type)?.value);
    return { year: get('year'), month: get('month') - 1, day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
}

/** Epoch ms of a wall-clock time in `timeZone`, or in the process's zone without one. Day overflow rolls into the next month. */
function wallClockTime(year: number, month: number, day: number, hour: number, minute: number, timeZone?: string): number {
    if (!timeZone) return new Date(year, month, day, hour, minute).getTime();
    const asUtc = Date.UTC(year, month, day, hour, minute);
    const offsetAt = (t: number) => {
        const p = wallClockParts(t, timeZone);
        return Date.UTC(p.year, p.month, p.day, p.hour, p.minute, p.second) - Math.floor(t / 1000) * 1000;
    };
    const first = asUtc - offsetAt(asUtc);
    return asUtc - offsetAt(first);
}

function todayIn(now: number, timeZone?: string) {
    if (timeZone) return wallClockParts(now, timeZone);
    const d = new Date(now);
    return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate() };
}

function validTimeZone(zone: string | undefined): string | undefined {
    if (!zone) return undefined;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: zone });
        return zone;
    } catch {
        return undefined;
    }
}

function to24h(hour: number, meridiem: string): number {
    return (hour % 12) + (meridiem.toLowerCase() === 'pm' ? 12 : 0);
}

/** The next time at or after `now` that shows this wall clock, on the given date or else today or tomorrow. */
function nextWallClock(now: number, hour: number, minute: number, date: { month: number; day: number; year?: number } | null, timeZone?: string): number {
    const today = todayIn(now, timeZone);
    if (date) {
        const at = wallClockTime(date.year ?? today.year, date.month, date.day, hour, minute, timeZone);
        return date.year === undefined && at < now - DAY_MS ? wallClockTime(today.year + 1, date.month, date.day, hour, minute, timeZone) : at;
    }
    const at = wallClockTime(today.year, today.month, today.day, hour, minute, timeZone);
    return at > now ? at : wallClockTime(today.year, today.month, today.day + 1, hour, minute, timeZone);
}

const EPOCH_SUFFIX_RE = /usage limit reached\|(\d{9,13})/i;
// Claude Code: "resets 3pm (Europe/Madrid)", "resets Nov 3, 3:30pm (UTC)", "resets Jan 2, 2027, 6pm".
const CLAUDE_RESETS_RE = /\bresets (?:([a-z]{3}) (\d{1,2}), (?:(\d{4}), )?)?(\d{1,2})(?::(\d{2}))?\s?([ap]m)\b(?: \(([^)]+)\))?/i;
// Codex, in local time: "try again at 3:42 PM", "try again at Nov 2nd, 2026 3:42 PM".
const CODEX_AT_RE = /try again at (?:([a-z]{3}) (\d{1,2})(?:st|nd|rd|th)?, (\d{4}) )?(\d{1,2}):(\d{2})\s?([ap]m)\b/i;
const TRY_IN_RE = /try again in ([^.\n]*(?:\.\d[^.\n]*)*)/i;
const DURATION_PART_RE = /(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?|d|days?)\b/gi;

function unitMs(unit: string): number {
    const u = unit.toLowerCase();
    if (u === 'ms' || u.startsWith('milli')) return 1;
    if (u.startsWith('s')) return 1_000;
    if (u.startsWith('m')) return 60_000;
    if (u.startsWith('h')) return 3_600_000;
    return DAY_MS;
}

/**
 * When a usage or rate limit lifts, read from the text a provider CLI left
 * behind (epoch ms), or undefined when the text doesn't say.
 */
export function parseUsageLimitReset(text: string, now = Date.now()): number | undefined {
    const epoch = EPOCH_SUFFIX_RE.exec(text);
    if (epoch) {
        const n = Number(epoch[1]);
        return n < 1e12 ? n * 1000 : n;
    }

    const claude = CLAUDE_RESETS_RE.exec(text);
    if (claude) {
        const [, mon, day, year, hour, minute, meridiem, zone] = claude;
        const month = mon ? MONTHS.indexOf(mon.toLowerCase()) : -1;
        if (!mon || month >= 0) {
            const date = mon ? { month, day: Number(day), year: year ? Number(year) : undefined } : null;
            return nextWallClock(now, to24h(Number(hour), meridiem), Number(minute ?? 0), date, validTimeZone(zone));
        }
    }

    const codex = CODEX_AT_RE.exec(text);
    if (codex) {
        const [, mon, day, year, hour, minute, meridiem] = codex;
        const month = mon ? MONTHS.indexOf(mon.toLowerCase()) : -1;
        if (!mon || month >= 0) {
            const date = mon ? { month, day: Number(day), year: Number(year) } : null;
            return nextWallClock(now, to24h(Number(hour), meridiem), Number(minute), date);
        }
    }

    const tryIn = TRY_IN_RE.exec(text);
    if (tryIn) {
        let ms = 0;
        for (const [, amount, unit] of tryIn[1].matchAll(DURATION_PART_RE)) ms += Number(amount) * unitMs(unit);
        if (ms > 0) return now + Math.round(ms);
    }
    return undefined;
}

const MESSAGE_MAX = 2_000;

/** A provider CLI run that produced no answer, with the most specific text it left behind. */
export class AgentRunError extends Error {
    readonly kind: AgentFailureKind;
    /** For a rate limit: when it lifts (epoch ms), if the provider said. */
    readonly resetsAt?: number;

    constructor(message: string, kind: AgentFailureKind = classifyAgentFailure(message), details: { resetsAt?: number } = {}) {
        super(redactSecretText(message).slice(0, MESSAGE_MAX));
        this.name = 'AgentRunError';
        this.kind = kind;
        if (kind === 'rate_limit') this.resetsAt = details.resetsAt ?? parseUsageLimitReset(message);
    }
}

export function toAgentRunError(error: unknown): AgentRunError {
    if (error instanceof AgentRunError) return error;
    const message = error instanceof Error ? error.message : String(error);
    return new AgentRunError(message || 'Agent run failed');
}

const DETAIL_MAX = 240;

function excerpt(detail: string): string {
    const line = detail.split('\n').map(l => l.trim()).find(Boolean) ?? '';
    return line.length > DETAIL_MAX ? `${line.slice(0, DETAIL_MAX - 1)}…` : line;
}

/**
 * What a person reads when a run fails. `summary` goes everywhere; `remedy`
 * is the channel-only follow-up, since the dashboard renders its own action.
 */
export function describeAgentFailure(kind: AgentFailureKind, providerLabel: string, detail: string): { summary: string; remedy?: string } {
    switch (kind) {
        case 'auth': {
            const what = /expired/i.test(detail) ? 'expired' : 'was rejected';
            return {
                summary: `${providerLabel} sign-in ${what}, so I couldn't answer.`,
                remedy: 'Set a new token in the dashboard settings.',
            };
        }
        case 'rate_limit':
            return { summary: `${providerLabel} is rate limiting right now.`, remedy: 'Try again in a few minutes.' };
        case 'billing':
            return { summary: `${providerLabel} rejected the request over billing.`, remedy: "Check the account's credits." };
        case 'stalled':
            return { summary: `${providerLabel} stopped responding, so I stopped it.`, remedy: 'Try again.' };
        default: {
            const line = excerpt(detail);
            return { summary: line ? `I couldn't finish answering. ${line}` : "I couldn't finish answering." };
        }
    }
}
