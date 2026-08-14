// Runs via root `npm test` (vitest's default glob sweeps the dashboard even
// though it isn't a workspace). Imports must stay relative — nothing maps the
// "@/" alias outside Next.

import { describe, it, expect } from 'vitest';
import type { TorrentRecord, TorrentStatus } from './api-types';
import {
    isStalled, isFinished, isFailedAdd, recency, statusGroupRank, sortTorrents,
    moveId, applyQueuePositions, queueDropPosition,
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

    it('isFailedAdd requires error with zero progress', () => {
        expect(isFailedAdd(makeTorrent({ status: 'error', progress: 0 }))).toBe(true);
        expect(isFailedAdd(makeTorrent({ status: 'error', progress: 0.4 }))).toBe(false);
        expect(isFailedAdd(makeTorrent({ progress: 0 }))).toBe(false);
    });

    it('recency coalesces completedAt over addedAt', () => {
        expect(recency(makeTorrent({ addedAt: 10, completedAt: 20 }))).toBe(20);
        expect(recency(makeTorrent({ addedAt: 10 }))).toBe(10);
    });
});

describe('status sort', () => {
    it('orders groups: error, stalled, adding, checking, downloading, queued, paused, seeding, completed', () => {
        const torrents = [
            makeTorrent({ status: 'completed', progress: 1 }),
            makeTorrent({ status: 'seeding', progress: 1 }),
            makeTorrent({ status: 'paused' }),
            makeTorrent({ status: 'queued' }),
            makeTorrent({ status: 'downloading' }),
            makeTorrent({ status: 'checking' }),
            makeTorrent({ status: 'adding' }),
            makeTorrent({ status: 'downloading', stalledSince: 999 }),
            makeTorrent({ status: 'error' }),
        ];
        const sorted = sortTorrents(torrents, 'status');
        expect(sorted.map(t => (isStalled(t) ? 'stalled' : t.status))).toEqual([
            'error', 'stalled', 'adding', 'checking', 'downloading', 'queued', 'paused', 'seeding', 'completed',
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
    it('active covers adding, checking, downloading, queued (including stalled)', () => {
        const { active } = TORRENT_PILL_PREDICATES;
        expect(active(makeTorrent({ status: 'adding' }))).toBe(true);
        expect(active(makeTorrent({ status: 'checking' }))).toBe(true);
        expect(active(makeTorrent({ status: 'queued' }))).toBe(true);
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

describe('queue sort', () => {
    it('orders by queuePosition with unpositioned torrents last', () => {
        const list = [
            makeTorrent({ queuePosition: 2 }),
            makeTorrent({ queuePosition: 0 }),
            makeTorrent({}),
            makeTorrent({ queuePosition: 1 }),
        ];
        expect(sortTorrents(list, 'queue').map(t => t.queuePosition)).toEqual([0, 1, 2, undefined]);
    });
});

describe('queue helpers', () => {
    it('moveId relocates one id preserving the rest', () => {
        expect(moveId(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
        expect(moveId(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    });

    it('applyQueuePositions rewrites only the listed ids', () => {
        const a = makeTorrent({ queuePosition: 5 });
        const b = makeTorrent({ queuePosition: 6 });
        const other = makeTorrent({ queuePosition: 9 });
        const next = applyQueuePositions([a, b, other], [b.id, a.id]);
        expect(next.find(t => t.id === b.id)?.queuePosition).toBe(0);
        expect(next.find(t => t.id === a.id)?.queuePosition).toBe(1);
        expect(next.find(t => t.id === other.id)?.queuePosition).toBe(9);
    });

    it('queueDropPosition lands after the preceding neighbor in both directions', () => {
        const list = [0, 1, 2, 3].map(p => makeTorrent({ queuePosition: p }));
        const byId = new Map(list.map(t => [t.id, t]));
        // list[3] pulled up between 0 and 1: prev keeps its slot, land after it.
        const movedUp = [list[0].id, list[3].id, list[1].id, list[2].id];
        expect(queueDropPosition(byId, movedUp, 1)).toBe(1);
        // list[0] pushed down after 2: removal shifts prev one earlier first.
        const movedDown = [list[1].id, list[2].id, list[0].id, list[3].id];
        expect(queueDropPosition(byId, movedDown, 2)).toBe(2);
        expect(queueDropPosition(byId, movedUp, 0)).toBe(0);
    });
});
