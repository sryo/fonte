import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, type Mock } from 'vitest';

vi.mock('./poster-manager', () => ({
    fetchTorrentPoster: vi.fn(async () => undefined),
    backfillPosters: vi.fn(async () => undefined),
}));

// Only aggregateSearch talks to Jackett; filterByTitle/rankResults/
// computeQualityMatch/extractInfoHash stay real so the runner's selection
// logic is exercised end to end.
vi.mock('./search-aggregator', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./search-aggregator')>();
    return { ...actual, aggregateSearch: vi.fn(async () => []) };
});

// Same FONTE_HOME dance as torrent-manager.test.ts: core resolves paths once
// at import time, so the temp home must be set before the first dynamic import.
let tmpHome: string;
let db: typeof import('./torrent-db');
let wdb: typeof import('./watchlist-db');
let conn: typeof import('./db-connection');
let TM: typeof import('./torrent-manager');
let runner: typeof import('./watchlist-runner');
let aggregateSearch: Mock;
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
    aggregateSearch = vi.mocked((await import('./search-aggregator')).aggregateSearch) as unknown as Mock;
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

describe('ongoing-watch fall-through', () => {
    const HEX2 = '0123456789abcdef0123456789abcdef01234567';
    const MAGNET2 = `magnet:?xt=urn:btih:${HEX2}&dn=Show+S01E05+1080p`;

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
