import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

// Same single-temp-home setup as torrent-db.test.ts: FONTE_HOME resolves once
// at import time, so it must be set before the first dynamic import.
let tmpHome: string;
let tdb: typeof import('./torrent-db');
let wdb: typeof import('./watchlist-db');
let conn: typeof import('./db-connection');

beforeAll(async () => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fonte-watchlist-db-test-'));
    process.env.FONTE_HOME = tmpHome;
    tdb = await import('./torrent-db');
    wdb = await import('./watchlist-db');
    conn = await import('./db-connection');
    tdb.initTorrentDb();
});

afterAll(() => {
    tdb.closeTorrentDb();
    delete process.env.FONTE_HOME;
    fs.rmSync(tmpHome, { recursive: true, force: true });
});

beforeEach(() => {
    conn.getDb().exec('DELETE FROM watchlist_results; DELETE FROM watchlist;');
});

function insertEntry(id: string, overrides: Partial<Parameters<typeof wdb.insertWatchlistEntry>[0]> = {}): void {
    wdb.insertWatchlistEntry({
        id,
        title: `Entry ${id}`,
        mediaType: 'tv',
        quality: '1080p',
        searchQuery: `entry ${id} 1080p`,
        category: 5000,
        ...overrides,
    });
}

function insertResult(watchlistId: string, magnetUri: string, overrides: Partial<Parameters<typeof wdb.insertWatchlistResult>[0]> = {}): number {
    return wdb.insertWatchlistResult({
        watchlistId,
        title: 'Some.Release.1080p',
        magnetUri,
        seeders: 10,
        leechers: 2,
        size: 1_000_000,
        qualityMatch: 80,
        ...overrides,
    });
}

describe('isOngoingWatch', () => {
    it('tv and music without a season pattern are ongoing', () => {
        expect(wdb.isOngoingWatch({ mediaType: 'tv', seasonPattern: undefined })).toBe(true);
        expect(wdb.isOngoingWatch({ mediaType: 'music', seasonPattern: undefined })).toBe(true);
    });

    it('movies and season-pattern entries are bounded', () => {
        expect(wdb.isOngoingWatch({ mediaType: 'movie', seasonPattern: undefined })).toBe(false);
        expect(wdb.isOngoingWatch({ mediaType: 'tv', seasonPattern: 'S02' })).toBe(false);
        expect(wdb.isOngoingWatch({ mediaType: 'book', seasonPattern: undefined })).toBe(false);
    });
});

describe('insertWatchlistResult upsert', () => {
    it('re-finding a magnet refreshes found_at but preserves first_found_at', () => {
        insertEntry('wl1');
        const rid = insertResult('wl1', 'magnet:?xt=urn:btih:aaa');

        // Backdate both timestamps so the refresh is observable.
        conn.getDb().prepare(
            'UPDATE watchlist_results SET found_at = 1000, first_found_at = 1000 WHERE id = ?'
        ).run(rid);

        const again = insertResult('wl1', 'magnet:?xt=urn:btih:aaa', { seeders: 99 });
        expect(again).toBe(rid);

        const row = conn.getDb().prepare(
            'SELECT found_at, first_found_at, seeders FROM watchlist_results WHERE id = ?'
        ).get(rid) as { found_at: number; first_found_at: number; seeders: number };
        expect(row.found_at).toBeGreaterThan(1000);
        expect(row.first_found_at).toBe(1000);
        expect(row.seeders).toBe(99);
    });
});

describe('new result counts', () => {
    it('counts unselected results first found after the last view', () => {
        insertEntry('wl1');
        insertResult('wl1', 'magnet:?xt=urn:btih:aaa');
        insertResult('wl1', 'magnet:?xt=urn:btih:bbb');

        // Never viewed: everything is new.
        expect(wdb.getNewResultCounts()).toEqual({ wl1: 2 });

        wdb.markWatchlistResultsViewed('wl1');
        expect(wdb.getNewResultCounts()).toEqual({});

        // A result first found after the view counts again.
        const rid = insertResult('wl1', 'magnet:?xt=urn:btih:ccc');
        conn.getDb().prepare(
            'UPDATE watchlist_results SET first_found_at = first_found_at + 60000 WHERE id = ?'
        ).run(rid);
        expect(wdb.getNewResultCounts()).toEqual({ wl1: 1 });
    });

    it('excludes selected results', () => {
        insertEntry('wl1');
        const rid = insertResult('wl1', 'magnet:?xt=urn:btih:aaa');
        wdb.markResultSelected(rid);
        expect(wdb.getNewResultCounts()).toEqual({});
    });

    it('groups per entry', () => {
        insertEntry('wl1');
        insertEntry('wl2');
        insertResult('wl1', 'magnet:?xt=urn:btih:aaa');
        insertResult('wl2', 'magnet:?xt=urn:btih:bbb');
        insertResult('wl2', 'magnet:?xt=urn:btih:ccc');
        expect(wdb.getNewResultCounts()).toEqual({ wl1: 1, wl2: 2 });
    });
});
