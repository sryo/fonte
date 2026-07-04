// Runs via root `npm test` (vitest's default glob sweeps the dashboard even
// though it isn't a workspace). Imports must stay relative — nothing maps the
// "@/" alias outside Next.

import { describe, it, expect } from 'vitest';
import type { TorrentRecord, TorrentStatus } from './api-types';
import {
    isStalled, isFinished, recency, statusGroupRank, sortTorrents,
    TORRENT_PILL_PREDICATES, countTorrentPills,
} from './torrent-order';

let seq = 0;
function makeTorrent(overrides: Partial<TorrentRecord> = {}): TorrentRecord {
    seq++;
    return {
        id: `t${String(seq).padStart(3, '0')}`,
        infoHash: `hash-${seq}`,
        name: `Torrent ${seq}`,
        status: 'downloading',
        progress: 0.5,
        downloadSpeed: 0,
        uploadSpeed: 0,
        downloaded: 0,
        uploaded: 0,
        size: 1000,
        numPeers: 0,
        savePath: '/downloads',
        files: [],
        addedAt: 1_000_000 + seq,
        ...overrides,
    };
}

describe('derived predicates', () => {
    it('isStalled requires downloading + stalledSince', () => {
        expect(isStalled(makeTorrent({ stalledSince: 123 }))).toBe(true);
        expect(isStalled(makeTorrent())).toBe(false);
        expect(isStalled(makeTorrent({ status: 'paused', stalledSince: 123 }))).toBe(false);
    });

    it('isFinished covers seeding and completed only', () => {
        const finished = (['seeding', 'completed'] as TorrentStatus[]).map(status => makeTorrent({ status }));
        const unfinished = (['adding', 'downloading', 'checking', 'paused', 'error'] as TorrentStatus[]).map(status => makeTorrent({ status }));
        expect(finished.every(isFinished)).toBe(true);
        expect(unfinished.some(isFinished)).toBe(false);
    });

    it('recency coalesces completedAt over addedAt', () => {
        expect(recency(makeTorrent({ addedAt: 10, completedAt: 20 }))).toBe(20);
        expect(recency(makeTorrent({ addedAt: 10 }))).toBe(10);
    });
});

describe('status sort', () => {
    it('orders groups: error, stalled, adding, checking, downloading, paused, seeding, completed', () => {
        const torrents = [
            makeTorrent({ status: 'completed', progress: 1 }),
            makeTorrent({ status: 'seeding', progress: 1 }),
            makeTorrent({ status: 'paused' }),
            makeTorrent({ status: 'downloading' }),
            makeTorrent({ status: 'checking' }),
            makeTorrent({ status: 'adding' }),
            makeTorrent({ status: 'downloading', stalledSince: 999 }),
            makeTorrent({ status: 'error' }),
        ];
        const sorted = sortTorrents(torrents, 'status');
        expect(sorted.map(t => (isStalled(t) ? 'stalled' : t.status))).toEqual([
            'error', 'stalled', 'adding', 'checking', 'downloading', 'paused', 'seeding', 'completed',
        ]);
    });

    it('sorts newest first within a group and never mutates the input', () => {
        const older = makeTorrent({ addedAt: 100 });
        const newer = makeTorrent({ addedAt: 200 });
        const input = [older, newer];
        const sorted = sortTorrents(input, 'status');
        expect(sorted.map(t => t.id)).toEqual([newer.id, older.id]);
        expect(input[0]).toBe(older);
    });

    it('ranks stalled between error and adding', () => {
        expect(statusGroupRank(makeTorrent({ status: 'error' }))).toBeLessThan(
            statusGroupRank(makeTorrent({ stalledSince: 1 })));
        expect(statusGroupRank(makeTorrent({ stalledSince: 1 }))).toBeLessThan(
            statusGroupRank(makeTorrent({ status: 'adding' })));
    });
});

describe('other sorts', () => {
    it('recent sorts by latest event, completedAt beating addedAt', () => {
        const finishedRecently = makeTorrent({ status: 'completed', addedAt: 100, completedAt: 500 });
        const addedLater = makeTorrent({ addedAt: 300 });
        const sorted = sortTorrents([addedLater, finishedRecently], 'recent');
        expect(sorted.map(t => t.id)).toEqual([finishedRecently.id, addedLater.id]);
    });

    it('name sort is numeric-aware', () => {
        const e10 = makeTorrent({ name: 'Episode 10' });
        const e2 = makeTorrent({ name: 'Episode 2' });
        expect(sortTorrents([e10, e2], 'name').map(t => t.name)).toEqual(['Episode 2', 'Episode 10']);
    });

    it('progress sorts descending with recency tiebreak', () => {
        const half = makeTorrent({ progress: 0.5, addedAt: 100 });
        const done = makeTorrent({ progress: 1, addedAt: 100 });
        const halfNewer = makeTorrent({ progress: 0.5, addedAt: 200 });
        expect(sortTorrents([half, done, halfNewer], 'progress').map(t => t.id))
            .toEqual([done.id, halfNewer.id, half.id]);
    });
});

describe('pill predicates', () => {
    it('active covers adding, checking, downloading (including stalled)', () => {
        const { active } = TORRENT_PILL_PREDICATES;
        expect(active(makeTorrent({ status: 'adding' }))).toBe(true);
        expect(active(makeTorrent({ status: 'checking' }))).toBe(true);
        expect(active(makeTorrent({ stalledSince: 1 }))).toBe(true);
        expect(active(makeTorrent({ status: 'seeding' }))).toBe(false);
        expect(active(makeTorrent({ status: 'paused' }))).toBe(false);
    });

    it('paused excludes completed', () => {
        const { paused } = TORRENT_PILL_PREDICATES;
        expect(paused(makeTorrent({ status: 'paused' }))).toBe(true);
        expect(paused(makeTorrent({ status: 'completed' }))).toBe(false);
    });

    it('issues matches error or stalled', () => {
        const { issues } = TORRENT_PILL_PREDICATES;
        expect(issues(makeTorrent({ status: 'error' }))).toBe(true);
        expect(issues(makeTorrent({ stalledSince: 1 }))).toBe(true);
        expect(issues(makeTorrent())).toBe(false);
    });

    it('countTorrentPills tallies overlapping pills independently', () => {
        const counts = countTorrentPills([
            makeTorrent({ status: 'seeding' }),
            makeTorrent({ status: 'completed' }),
            makeTorrent({ status: 'error' }),
            makeTorrent({ stalledSince: 1 }),
        ]);
        expect(counts).toEqual({ active: 1, seeding: 1, paused: 0, finished: 2, issues: 2 });
    });
});
