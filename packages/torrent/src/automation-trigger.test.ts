import { describe, it, expect } from 'vitest';
import {
    parseTrigger, parseLegacyTrigger, describeTrigger, describeCron, triggerEvents, nextRunAt, isValidCron,
} from './automation-trigger';

describe('parseTrigger', () => {
    it('accepts an event member', () => {
        expect(parseTrigger({ type: 'event', event: 'torrent:completed' })).toEqual({ type: 'event', event: 'torrent:completed' });
    });

    it('rejects unknown events and bad cron', () => {
        expect(parseTrigger({ type: 'event', event: 'torrent:nope' })).toBeNull();
        expect(parseTrigger({ type: 'cron', schedule: 'every tuesday' })).toBeNull();
        expect(parseTrigger({ type: 'cron', schedule: '0 9 * *' })).toBeNull();
        expect(parseTrigger({ type: 'once', runAt: 'not a date' })).toBeNull();
        expect(parseTrigger('torrent:completed')).toBeNull();
    });

    it('normalizes cron whitespace and once dates', () => {
        expect(parseTrigger({ type: 'cron', schedule: '  0   9 * * 1-5 ' })).toEqual({ type: 'cron', schedule: '0 9 * * 1-5' });
        const once = parseTrigger({ type: 'once', runAt: '2030-01-02T03:04:00Z' });
        expect(once).toEqual({ type: 'once', runAt: '2030-01-02T03:04:00.000Z' });
    });

    it('collapses a one-member group and accepts the bare-array shorthand', () => {
        expect(parseTrigger({ type: 'group', members: [{ type: 'event', event: 'watchlist:match' }] }))
            .toEqual({ type: 'event', event: 'watchlist:match' });
        expect(parseTrigger([{ type: 'event', event: 'watchlist:match' }, { type: 'cron', schedule: '0 8 * * 1-5' }]))
            .toEqual({ type: 'group', members: [{ type: 'event', event: 'watchlist:match' }, { type: 'cron', schedule: '0 8 * * 1-5' }] });
    });

    it('rejects a group with any invalid member, or an empty one', () => {
        expect(parseTrigger([{ type: 'event', event: 'watchlist:match' }, { type: 'cron', schedule: 'x' }])).toBeNull();
        expect(parseTrigger([])).toBeNull();
    });

    it('dedupes identical members', () => {
        expect(parseTrigger([{ type: 'event', event: 'watchlist:match' }, { type: 'event', event: 'watchlist:match' }]))
            .toEqual({ type: 'event', event: 'watchlist:match' });
    });
});

describe('parseLegacyTrigger', () => {
    it('maps the old columns', () => {
        expect(parseLegacyTrigger('torrent:added', {})).toEqual({ type: 'event', event: 'torrent:added' });
        expect(parseLegacyTrigger('schedule', { cron: '0 3 * * *' })).toEqual({ type: 'cron', schedule: '0 3 * * *' });
        expect(parseLegacyTrigger('schedule', {})).toBeNull();
        expect(parseLegacyTrigger('bogus', {})).toBeNull();
    });
});

describe('describeTrigger', () => {
    it('describes events, schedules and groups in words', () => {
        expect(describeTrigger({ type: 'event', event: 'torrent:completed' })).toBe('When a torrent completes');
        expect(describeTrigger({ type: 'cron', schedule: '30 8 * * 1-5' })).toBe('Weekdays at 8:30 AM');
        expect(describeTrigger({
            type: 'group',
            members: [{ type: 'event', event: 'watchlist:match' }, { type: 'cron', schedule: '0 8 * * 1-5' }],
        })).toBe('When a watchlist match is added or weekdays at 8:00 AM');
    });

    it('covers the editor shapes and falls back to the raw expression', () => {
        expect(describeCron('0 9 * * *')).toBe('Every day at 9:00 AM');
        expect(describeCron('15 14 * * 1,3')).toBe('Every Monday and Wednesday at 2:15 PM');
        expect(describeCron('0 0 1 * *')).toBe('Monthly on the 1st at 12:00 AM');
        expect(describeCron('*/15 * * * *')).toBe('Every 15 minutes');
        expect(describeCron('32 * * * *')).toBe('Every hour at :32');
        expect(describeCron('0 * * * *')).toBe('Every hour');
        expect(describeCron('0 9 * 6 *')).toBe('0 9 * 6 *');
    });
});

describe('helpers', () => {
    it('lists the events a trigger listens for', () => {
        expect(triggerEvents({ type: 'cron', schedule: '0 9 * * *' })).toEqual([]);
        expect(triggerEvents([{ type: 'event', event: 'torrent:error' }, { type: 'event', event: 'torrent:stalled' }] as any)).toEqual([]);
        expect(triggerEvents(parseTrigger([{ type: 'event', event: 'torrent:error' }, { type: 'event', event: 'torrent:stalled' }])!))
            .toEqual(['torrent:error', 'torrent:stalled']);
    });

    it('computes the earliest next run across members', () => {
        const now = Date.UTC(2030, 0, 1, 12, 0, 0);
        const once = new Date(now + 60_000).toISOString();
        const next = nextRunAt({ type: 'group', members: [{ type: 'cron', schedule: '0 0 1 1 *' }, { type: 'once', runAt: once }] }, now);
        expect(next).toBe(now + 60_000);
        expect(nextRunAt({ type: 'event', event: 'torrent:completed' }, now)).toBeNull();
        expect(nextRunAt({ type: 'once', runAt: new Date(now - 1).toISOString() }, now)).toBeNull();
    });

    it('validates cron through croner', () => {
        expect(isValidCron('0 9 * * 1-5')).toBe(true);
        expect(isValidCron('99 9 * * *')).toBe(false);
    });
});
