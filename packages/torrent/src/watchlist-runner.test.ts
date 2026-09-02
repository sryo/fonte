import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, type Mock } from 'vitest';

vi.mock('./poster-manager', () => ({
    fetchTorrentPoster: vi.fn(async () => undefined),
    backfillPosters: vi.fn(async () => undefined),
}));

// Only searchReleasesReport talks to the sources; rankResults/
// computeQualityMatch/extractInfoHash stay real so the runner's selection
// logic is exercised end to end.
vi.mock('./search-aggregator', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./search-aggregator')>();
    return { ...actual, searchReleasesReport: vi.fn(async () => report([])) };
});

type Report = import('./search-aggregator').SearchReport;
const okSource = (results: number) => ({ source: 'mock', ok: true, results });
function report(results: any[], extra: Partial<Report> = {}): Report {
    const sources = extra.sources ?? [okSource(results.length)];
    const failed = sources.filter(s => !s.ok);
    return { results, sources, failed, allFailed: sources.length > 0 && failed.length === sources.length, ...extra };
}

// Same FONTE_HOME dance as torrent-manager.test.ts: core resolves paths once
// at import time, so the temp home must be set before the first dynamic import.
let tmpHome: string;
let db: typeof import('./torrent-db');
let wdb: typeof import('./watchlist-db');
let conn: typeof import('./db-connection');
let TM: typeof import('./torrent-manager');
let runner: typeof import('./watchlist-runner');
let searchReleasesReport: Mock;
// Result-shaped shim over the report mock, so the selection tests read as before.
const aggregateSearch = {
    mockResolvedValue: (results: any[]) => { searchReleasesReport.mockResolvedValue(report(results)); return aggregateSearch; },
    mockReset: () => { searchReleasesReport.mockReset(); return aggregateSearch; },
};
let WATCHLIST_EVENTS: typeof import('./watchlist-events').WATCHLIST_EVENTS;

const events: { type: string; data: Record<string, unknown> }[] = [];
const eventsOf = (type: string) => events.filter(e => e.type === type);

const HEX = 'fedcba9876543210fedcba9876543210fedcba98';
const MAGNET = `magnet:?xt=urn:btih:${HEX}&dn=Show+S01+1080p`;

beforeAll(async () => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fonte-watchlist-runner-test-'));
    process.env.FONTE_HOME = tmpHome;
    fs.mkdirSync(path.join(tmpHome, 'logs'), { recursive: true }); // core's log() appends to logs/queue.log
    fs.writeFileSync(path.join(tmpHome, 'settings.json'), JSON.stringify({
        watchlist: {
            jackett_url: 'http://localhost:9117',
            jackett_api_key: 'test-key',
            auto_add: true,
            preferred_quality: '1080p',
        },
    }));

    db = await import('./torrent-db');
    wdb = await import('./watchlist-db');
    conn = await import('./db-connection');
    TM = await import('./torrent-manager');
    runner = await import('./watchlist-runner');
    searchReleasesReport = vi.mocked((await import('./search-aggregator')).searchReleasesReport) as unknown as Mock;
    WATCHLIST_EVENTS = (await import('./watchlist-events')).WATCHLIST_EVENTS;
    const core = await import('@fonte/core');
    core.onEvent((type, data) => { events.push({ type, data }); });
    db.initTorrentDb();
});

afterAll(() => {
    db.closeTorrentDb();
    delete process.env.FONTE_HOME;
    fs.rmSync(tmpHome, { recursive: true, force: true });
});

beforeEach(() => {
    conn.getDb().exec('DELETE FROM watchlist_results; DELETE FROM watchlist; DELETE FROM torrent_files; DELETE FROM torrents;');
    events.length = 0;
    aggregateSearch.mockReset().mockResolvedValue([]);
});

function seedEntry(): void {
    wdb.insertWatchlistEntry({
        id: 'wl1',
        title: 'Show',
        mediaType: 'movie',
        quality: '1080p',
        searchQuery: 'Show',
        category: 2000,
    });
}

const searchResult = () => ({
    title: 'Show S01 1080p WEB-DL',
    magnetUri: MAGNET,
    seeders: 12,
    leechers: 3,
    size: 5_000_000_000,
    indexer: 'mock',
});

// The runner reaches Transmission through the getTorrentManager() singleton;
// install one with a fake RPC. `behavior.failAdd` is read per call so a test
// can flip it between check cycles.
function installManager(behavior: { failAdd?: boolean } = {}) {
    const manager = TM.createTorrentManager();
    (manager as any).rpc = {
        call: async (method: string) => {
            if (method === 'torrent-add') {
                if (behavior.failAdd) {
                    throw new Error("Transmission RPC: Couldn't fetch torrent: Internal Server Error (500)");
                }
                return { 'torrent-added': { id: 7, hashString: HEX, name: 'Show S01 1080p WEB-DL' } };
            }
            if (method === 'torrent-get') return { torrents: [] };
            return {};
        },
    };
    return manager;
}

describe('watchlist auto-add duplicate handling', () => {
    it('auto-adds a fresh release and fulfills the movie entry', async () => {
        seedEntry();
        aggregateSearch.mockResolvedValue([searchResult()]);
        installManager();

        await runner.runWatchlistCheck();

        const added = db.getTorrentByHash(HEX);
        expect(added?.status).toBe('downloading');
        expect(eventsOf(WATCHLIST_EVENTS.MATCH)).toHaveLength(1);
        expect(wdb.getWatchlistEntry('wl1')?.status).toBe('fulfilled');
        expect(wdb.getWatchlistEntry('wl1')?.matchedTorrentId).toBe(added?.id);
    });

    it('retries a release blocked by an errored row and replaces it', async () => {
        seedEntry();
        db.insertTorrent({ id: 'tor_old', infoHash: HEX, name: '', status: 'error', savePath: '/downloads' });
        aggregateSearch.mockResolvedValue([searchResult()]);
        installManager();

        await runner.runWatchlistCheck();

        const added = db.getTorrentByHash(HEX);
        expect(added?.status).toBe('downloading');
        expect(added?.id).not.toBe('tor_old');
        expect(db.getTorrent('tor_old')).toBeUndefined();
        // Exactly one card for the release, none of them in Issues.
        expect(db.getTorrents()).toHaveLength(1);
        expect(db.getTorrents({ status: 'error' })).toHaveLength(0);
        expect(eventsOf(WATCHLIST_EVENTS.MATCH)).toHaveLength(1);
        expect(wdb.getWatchlistEntry('wl1')?.status).toBe('fulfilled');
        expect(wdb.getWatchlistEntry('wl1')?.matchedTorrentId).toBe(added?.id);
    });

    it('still skips a release whose torrent row is live', async () => {
        seedEntry();
        db.insertTorrent({ id: 'tor_live', infoHash: HEX, name: 'Show', status: 'downloading', savePath: '/downloads' });
        aggregateSearch.mockResolvedValue([searchResult()]);
        const manager = installManager();
        const addSpy = vi.spyOn(manager, 'addTorrent');

        await runner.runWatchlistCheck();

        expect(addSpy).not.toHaveBeenCalled();
        expect(db.getTorrents()).toHaveLength(1);
        expect(eventsOf(WATCHLIST_EVENTS.MATCH)).toHaveLength(0);
        expect(wdb.getWatchlistEntry('wl1')?.status).toBe('watching');
    });

    it('keeps one errored row on a failed retry, then recovers on a later cycle', async () => {
        seedEntry();
        db.insertTorrent({ id: 'tor_old', infoHash: HEX, name: '', status: 'error', savePath: '/downloads' });
        aggregateSearch.mockResolvedValue([searchResult()]);
        const behavior = { failAdd: true };
        installManager(behavior);

        await runner.runWatchlistCheck();

        const errored = db.getTorrents({ status: 'error' });
        expect(errored).toHaveLength(1);
        expect(errored[0].id).not.toBe('tor_old');
        expect(db.getTorrents()).toHaveLength(1);
        expect(eventsOf(WATCHLIST_EVENTS.MATCH)).toHaveLength(0);
        // Entry stays watching, so the next cycle retries.
        expect(wdb.getWatchlistEntry('wl1')?.status).toBe('watching');

        behavior.failAdd = false;
        await runner.runWatchlistCheck();

        expect(db.getTorrents()).toHaveLength(1);
        expect(db.getTorrents()[0].status).toBe('downloading');
        expect(db.getTorrents({ status: 'error' })).toHaveLength(0);
        expect(eventsOf(WATCHLIST_EVENTS.MATCH)).toHaveLength(1);
        expect(wdb.getWatchlistEntry('wl1')?.status).toBe('fulfilled');
    });
});

// Echoes the added magnet's own hash back, so tests can add releases with
// different hashes without colliding on installManager's fixed HEX.
function installEchoManager() {
    const manager = TM.createTorrentManager();
    (manager as any).rpc = {
        call: async (method: string, args: any) => {
            if (method === 'torrent-add') {
                const hash = /btih:([a-fA-F0-9]{40})/.exec(args.filename)?.[1] ?? HEX;
                return { 'torrent-added': { id: 7, hashString: hash, name: 'Show Release' } };
            }
            if (method === 'torrent-get') return { torrents: [] };
            return {};
        },
    };
    return manager;
}

describe('ongoing-watch fall-through', () => {
    const HEX2 = '0123456789abcdef0123456789abcdef01234567';
    const MAGNET2 = `magnet:?xt=urn:btih:${HEX2}&dn=Show+S01E05+1080p`;

    it('an ongoing watch falls through a tracked top release to the next episode', async () => {
        wdb.insertWatchlistEntry({
            id: 'wl2', title: 'Show', mediaType: 'tv',
            quality: '1080p', searchQuery: 'Show', category: 5000,
        });
        // The season pack (top-ranked by seeders) is already downloading.
        db.insertTorrent({ id: 'tor_pack', infoHash: HEX, name: 'Show S01 1080p WEB-DL', status: 'downloading', savePath: '/downloads' });
        aggregateSearch.mockResolvedValue([
            { ...searchResult(), seeders: 100 },
            { ...searchResult(), title: 'Show S01E05 1080p WEB-DL', magnetUri: MAGNET2, seeders: 5 },
        ]);
        installEchoManager();

        await runner.runWatchlistCheck();

        expect(db.getTorrentByHash(HEX2)?.status).toBe('downloading');
        expect(eventsOf(WATCHLIST_EVENTS.MATCH)).toHaveLength(1);
        // Ongoing watches stay watching for the next episode.
        expect(wdb.getWatchlistEntry('wl2')?.status).toBe('watching');
    });

    it('a one-shot watch does not fall through to a duplicate copy', async () => {
        seedEntry();
        db.insertTorrent({ id: 'tor_live', infoHash: HEX, name: 'Show S01 1080p WEB-DL', status: 'downloading', savePath: '/downloads' });
        aggregateSearch.mockResolvedValue([
            { ...searchResult(), seeders: 100 },
            { ...searchResult(), title: 'Show 1080p BluRay', magnetUri: MAGNET2, seeders: 5 },
        ]);
        installEchoManager();

        await runner.runWatchlistCheck();

        expect(db.getTorrentByHash(HEX2)).toBeUndefined();
        expect(eventsOf(WATCHLIST_EVENTS.MATCH)).toHaveLength(0);
    });
});

describe('feedback and removal blocking', () => {
    function seedResult(magnetUri: string, title = 'Show S01 1080p WEB-DL'): number {
        return wdb.insertWatchlistResult({
            watchlistId: 'wl1', title, magnetUri,
            seeders: 12, leechers: 3, size: 5_000_000_000, qualityMatch: 1,
        }).id;
    }

    it('never auto-adds a downvoted release', async () => {
        seedEntry();
        wdb.setResultFeedback(seedResult(MAGNET), -1);
        aggregateSearch.mockResolvedValue([searchResult()]);
        const manager = installManager();
        const addSpy = vi.spyOn(manager, 'addTorrent');

        await runner.runWatchlistCheck();

        expect(addSpy).not.toHaveBeenCalled();
        expect(db.getTorrentByHash(HEX)).toBeUndefined();
        expect(eventsOf(WATCHLIST_EVENTS.MATCH)).toHaveLength(0);
        expect(wdb.getWatchlistEntry('wl1')?.status).toBe('watching');
    });

    it('blocks by magnet URI when the hash is unparseable', async () => {
        const rawMagnet = 'magnet:?xt=urn:btih:aaa&dn=Show+S01+1080p';
        seedEntry();
        wdb.setResultFeedback(seedResult(rawMagnet), -1);
        aggregateSearch.mockResolvedValue([{ ...searchResult(), magnetUri: rawMagnet }]);
        const manager = installManager();
        const addSpy = vi.spyOn(manager, 'addTorrent');

        await runner.runWatchlistCheck();

        expect(addSpy).not.toHaveBeenCalled();
        expect(eventsOf(WATCHLIST_EVENTS.MATCH)).toHaveLength(0);
    });

    it('does not re-add a release the user removed', async () => {
        seedEntry();
        aggregateSearch.mockResolvedValue([searchResult()]);
        const manager = installManager();

        await runner.runWatchlistCheck();
        const added = db.getTorrentByHash(HEX);
        expect(added?.status).toBe('downloading');

        await manager.removeTorrent(added!.id);
        expect(db.getTorrentByHash(HEX)?.status).toBe('removed');
        wdb.updateWatchlistEntry('wl1', { status: 'watching' });
        const addSpy = vi.spyOn(manager, 'addTorrent');

        await runner.runWatchlistCheck();

        expect(addSpy).not.toHaveBeenCalled();
        expect(db.getTorrentByHash(HEX)?.status).toBe('removed');
        expect(eventsOf(WATCHLIST_EVENTS.MATCH)).toHaveLength(1);
    });

    it('affinity steers the pick away from downvoted traits', async () => {
        const HEX2 = '0123456789abcdef0123456789abcdef01234567';
        const MAGNET2 = `magnet:?xt=urn:btih:${HEX2}&dn=Show+1080p`;
        const HEX3 = 'aaaabbbbccccddddeeeeffff0000111122223333';

        seedEntry();
        wdb.setResultFeedback(
            seedResult(`magnet:?xt=urn:btih:${HEX3}&dn=Show`, 'Show 1080p WEBRip AV1 CHINESE-AnimeLand'), -1);
        // Without affinity the 50-seeder sibling of the downvoted release
        // outranks the clean 10-seeder one and would be the auto-add pick.
        aggregateSearch.mockResolvedValue([
            { ...searchResult(), title: 'Show 1080p WEBRip AV1 CHINESE-AnimeLand', magnetUri: MAGNET2, seeders: 50 },
            { ...searchResult(), title: 'Show 1080p WEB-DL x265-Good', magnetUri: MAGNET, seeders: 10 },
        ]);
        installEchoManager();

        await runner.runWatchlistCheck();

        expect(db.getTorrentByHash(HEX)?.status).toBe('downloading');
        expect(db.getTorrentByHash(HEX2)).toBeUndefined();
        expect(eventsOf(WATCHLIST_EVENTS.MATCH)).toHaveLength(1);
    });
});

describe('search category scoping', () => {
    it('passes the entry category to the search', async () => {
        seedEntry();
        installManager();

        await runner.runWatchlistCheck();

        expect(searchReleasesReport.mock.calls[0][0].category).toBe(2000);
    });

    it('omits the category filter for category-0 entries', async () => {
        wdb.insertWatchlistEntry({
            id: 'wl1', title: 'Show', mediaType: 'other',
            quality: '', searchQuery: 'Show', category: 0,
        });
        installManager();

        await runner.runWatchlistCheck();

        expect(searchReleasesReport.mock.calls[0][0].category).toBe(0);
    });
});

describe('check outcomes and backoff', () => {
    const failedReport = () => report([], {
        sources: [
            { source: 'eztv', ok: false, error: 'Challenge detected', results: 0 },
            { source: 'bt4g', ok: false, error: 'timed out', results: 0 },
        ],
    });

    it('records a failure on the entry when every source failed, and notifies with dedupe', async () => {
        seedEntry();
        searchReleasesReport.mockResolvedValue(failedReport());

        await runner.runWatchlistCheck({ force: true });
        let entry = wdb.getWatchlistEntry('wl1')!;
        expect(entry.lastError).toBe('eztv: Challenge detected, bt4g: timed out');
        expect(entry.failCount).toBe(1);
        expect(entry.lastCheckedAt).toBe(entry.lastErrorAt);

        const notified: boolean[] = [];
        for (let i = 0; i < 3; i++) await runner.runWatchlistCheck({ force: true });
        for (const e of eventsOf(WATCHLIST_EVENTS.CHECK_FAILED)) notified.push(e.data.notify as boolean);
        expect(notified).toEqual([true, true, false, true]);
        entry = wdb.getWatchlistEntry('wl1')!;
        expect(entry.failCount).toBe(4);
        expect(eventsOf(WATCHLIST_EVENTS.SEARCH)).toHaveLength(0);
    });

    it('keeps partial results, clears the error, and reports the dead sources', async () => {
        seedEntry();
        wdb.updateWatchlistEntry('wl1', { lastError: 'old', lastErrorAt: Date.now(), failCount: 2 });
        searchReleasesReport.mockResolvedValue(report([searchResult()], {
            sources: [okSource(1), { source: 'eztv', ok: false, error: 'Challenge detected', results: 0 }],
        }));
        installManager();

        await runner.runWatchlistCheck({ force: true });

        const entry = wdb.getWatchlistEntry('wl1')!;
        expect(entry.lastError).toBeUndefined();
        expect(entry.failCount).toBe(0);
        expect(entry.status).toBe('fulfilled');
        expect(eventsOf(WATCHLIST_EVENTS.CHECK_FAILED)).toHaveLength(0);
    });

    it('backs off an entry that keeps failing, unless forced', async () => {
        seedEntry();
        searchReleasesReport.mockResolvedValue(failedReport());
        const intervalMs = 30 * 60_000;

        await runner.runWatchlistCheck();
        expect(searchReleasesReport).toHaveBeenCalledTimes(1);
        // One failure: still tried on the next tick, but not before it.
        const once = wdb.getWatchlistEntry('wl1')!;
        expect(runner.isBackingOff(once, Date.now(), intervalMs)).toBe(true);
        expect(runner.isBackingOff(once, Date.now() + intervalMs, intervalMs)).toBe(false);

        await runner.runWatchlistCheck({ force: true });
        const twice = wdb.getWatchlistEntry('wl1')!;
        expect(twice.failCount).toBe(2);
        // Two failures: skips the next tick, runs the one after.
        expect(runner.isBackingOff(twice, Date.now() + intervalMs, intervalMs)).toBe(true);
        expect(runner.isBackingOff(twice, Date.now() + 2 * intervalMs, intervalMs)).toBe(false);
        // Eight failures cap at the maximum wait.
        expect(runner.isBackingOff({ failCount: 8, lastErrorAt: Date.now() }, Date.now() + 7 * intervalMs, intervalMs)).toBe(true);
        expect(runner.isBackingOff({ failCount: 8, lastErrorAt: Date.now() }, Date.now() + 8 * intervalMs, intervalMs)).toBe(false);

        // A backing-off entry is skipped by the scheduled run and included by a forced one.
        await runner.runWatchlistCheck();
        expect(searchReleasesReport).toHaveBeenCalledTimes(2);
        await runner.runWatchlistCheck({ force: true });
        expect(searchReleasesReport).toHaveBeenCalledTimes(3);
        expect(wdb.getWatchlistEntry('wl1')!.failCount).toBe(3);
    });

    it('checks entries concurrently', async () => {
        for (const id of ['a', 'b', 'c', 'd']) {
            wdb.insertWatchlistEntry({ id, title: `Show ${id}`, mediaType: 'movie', quality: '1080p', searchQuery: `Show ${id}`, category: 2000 });
        }
        let inFlight = 0;
        let peak = 0;
        searchReleasesReport.mockImplementation(async () => {
            inFlight += 1;
            peak = Math.max(peak, inFlight);
            await new Promise(r => setTimeout(r, 5));
            inFlight -= 1;
            return report([]);
        });

        await runner.runWatchlistCheck({ force: true });

        expect(searchReleasesReport).toHaveBeenCalledTimes(4);
        expect(peak).toBeGreaterThan(1);
        expect(peak).toBeLessThanOrEqual(3);
    });
});

describe('overlapping checks', () => {
    it('joins a check that is already running instead of starting a second one', async () => {
        seedEntry();
        let release!: () => void;
        searchReleasesReport.mockImplementation(() => new Promise<any>(resolve => { release = () => resolve(report([])); }));

        const first = runner.runWatchlistCheck();
        const second = runner.runWatchlistCheck({ force: true });
        release();
        await Promise.all([first, second]);

        expect(searchReleasesReport).toHaveBeenCalledTimes(1);
    });
});
