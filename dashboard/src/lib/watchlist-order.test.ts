import { describe, it, expect } from 'vitest';
import type { WatchlistRecord } from './api-types';
import { watchOrder } from './watchlist-order';

let seq = 0;
function makeEntry(overrides: Partial<WatchlistRecord> = {}): WatchlistRecord {
    seq++;
    return {
        id: `wl${String(seq).padStart(3, '0')}`,
        title: `Entry ${seq}`,
        searchQuery: `entry ${seq}`,
        mediaType: 'movie',
        quality: '1080p',
        category: 2000,
        status: 'watching',
        enabled: true,
        createdAt: 1_000_000 + seq,
        updatedAt: 1_000_000 + seq,
        ...overrides,
    } as WatchlistRecord;
}

describe('watchOrder', () => {
    it('orders finds first, then watching, paused, and fulfilled last', () => {
        const found = makeEntry({ newResultsCount: 3 });
        const quiet = makeEntry();
        const paused = makeEntry({ status: 'paused' });
        const fulfilled = makeEntry({ status: 'fulfilled' });
        const ordered = watchOrder([paused, quiet, fulfilled, found]);
        expect(ordered.map(w => w.id)).toEqual([found.id, quiet.id, paused.id, fulfilled.id]);
    });

    it('is stable across polls via id tiebreak', () => {
        const a = makeEntry();
        const b = makeEntry();
        expect(watchOrder([b, a]).map(w => w.id)).toEqual(watchOrder([a, b]).map(w => w.id));
    });
});
