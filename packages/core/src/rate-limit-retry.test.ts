import { describe, it, expect } from 'vitest';
import { planRateLimitRetry, formatPauseNotice } from './rate-limit-retry';

const MIN = 60_000;
const HOUR = 60 * MIN;
const now = new Date(2026, 9, 30, 13, 20, 0).getTime();

describe('planRateLimitRetry', () => {
    it('waits until a minute after a known reset', () => {
        const resetsAt = new Date(2026, 9, 30, 15, 0).getTime();
        expect(planRateLimitRetry({ resetsAt, now, pausedSoFarMs: 0, consecutiveUnknown: 0 }))
            .toEqual({ action: 'requeue', until: resetsAt + MIN, resetsAt });
    });

    it('waits for a known reset even when it is days away', () => {
        const resetsAt = now + 3 * 24 * HOUR;
        expect(planRateLimitRetry({ resetsAt, now, pausedSoFarMs: 0, consecutiveUnknown: 3 }))
            .toEqual({ action: 'requeue', until: resetsAt + MIN, resetsAt });
    });

    it('backs off 15 minutes without a reset, doubling per consecutive hit up to 2 hours', () => {
        const waits = [0, 1, 2, 3, 4, 9].map(consecutiveUnknown => {
            const plan = planRateLimitRetry({ now, pausedSoFarMs: 0, consecutiveUnknown });
            return plan.action === 'requeue' ? (plan.until - now) / MIN : null;
        });
        expect(waits).toEqual([15, 30, 60, 120, 120, 120]);
    });

    it('treats a reset that already passed as unknown', () => {
        expect(planRateLimitRetry({ resetsAt: now - MIN, now, pausedSoFarMs: 0, consecutiveUnknown: 1 }))
            .toEqual({ action: 'requeue', until: now + 30 * MIN });
    });

    it('gives up once the message has been paused for more than 12 hours in total', () => {
        expect(planRateLimitRetry({ now, pausedSoFarMs: 12 * HOUR, consecutiveUnknown: 5 }).action).toBe('requeue');
        expect(planRateLimitRetry({ now, pausedSoFarMs: 12 * HOUR + 1, consecutiveUnknown: 5 })).toEqual({ action: 'dead-letter' });
        expect(planRateLimitRetry({ resetsAt: now + HOUR, now, pausedSoFarMs: 13 * HOUR, consecutiveUnknown: 0 })).toEqual({ action: 'dead-letter' });
    });
});

describe('formatPauseNotice', () => {
    it('names the reset time when it is known, as HH:MM local time', () => {
        const resetsAt = new Date(2026, 9, 30, 15, 0).getTime();
        expect(formatPauseNotice({ providerLabel: 'Claude', until: resetsAt + MIN, resetsAt, now }))
            .toBe("Paused until 15:00. Claude's usage limit resets then.");
    });

    it('adds the date when the pause ends on another day', () => {
        const resetsAt = new Date(2026, 9, 31, 9, 5).getTime();
        expect(formatPauseNotice({ providerLabel: 'Codex', until: resetsAt + MIN, resetsAt, now }))
            .toBe("Paused until 09:05 on Oct 31. Codex's usage limit resets then.");
        const nextYear = new Date(2027, 0, 2, 18, 30).getTime();
        expect(formatPauseNotice({ providerLabel: 'Claude', until: nextYear + MIN, resetsAt: nextYear, now }))
            .toBe("Paused until 18:30 on Jan 2, 2027. Claude's usage limit resets then.");
    });

    it('says when it will try again when the reset is unknown', () => {
        expect(formatPauseNotice({ providerLabel: 'Claude', until: now + 15 * MIN, now }))
            .toBe("Paused until 13:35. Claude is rate limiting, so I'll try again then.");
    });
});
