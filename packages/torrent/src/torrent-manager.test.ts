import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { TorrentStatus } from './types';

vi.mock('./poster-manager', () => ({
    fetchTorrentPoster: vi.fn(async () => undefined),
}));

// Same FONTE_HOME dance as torrent-db.test.ts: core resolves paths once at
// import time, so the temp home must be set before the first dynamic import.
let tmpHome: string;
let db: typeof import('./torrent-db');
let conn: typeof import('./db-connection');
let TM: typeof import('./torrent-manager');
let TORRENT_EVENTS: typeof import('./torrent-events').TORRENT_EVENTS;

const events: { type: string; data: Record<string, unknown> }[] = [];
const eventsOf = (type: string) => events.filter(e => e.type === type);

beforeAll(async () => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fonte-torrent-manager-test-'));
    process.env.FONTE_HOME = tmpHome;
    fs.mkdirSync(path.join(tmpHome, 'logs'), { recursive: true }); // core's log() appends to logs/queue.log
    db = await import('./torrent-db');
    conn = await import('./db-connection');
    TM = await import('./torrent-manager');
    TORRENT_EVENTS = (await import('./torrent-events')).TORRENT_EVENTS;
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
    conn.getDb().exec('DELETE FROM torrent_files; DELETE FROM torrents;');
    events.length = 0;
});

function insertBasic(id: string, overrides: Partial<Parameters<typeof db.insertTorrent>[0]> = {}): void {
    db.insertTorrent({
        id,
        infoHash: `hash-${id}`,
        name: `Torrent ${id}`,
        status: 'downloading',
        savePath: '/downloads',
        ...overrides,
    });
}

// A row as returned by Transmission's torrent-get for the fields syncStats
// requests. No `files` key, so the nested syncTorrentFiles call no-ops.
function tRow(id: string, over: Record<string, unknown> = {}) {
    return {
        id: 1,
        hashString: `hash-${id}`,
        name: `Torrent ${id}`,
        status: 6,
        percentDone: 1,
        rateDownload: 0,
        rateUpload: 0,
        downloadedEver: 0,
        uploadedEver: 0,
        totalSize: 1000,
        peersConnected: 0,
        error: 0,
        errorString: '',
        ...over,
    };
}

function managerWith(rows: unknown[]) {
    const manager = new TM.TorrentManager();
    (manager as any).rpc = { call: async () => ({ torrents: rows }) };
    return manager;
}

const sync = (manager: InstanceType<typeof TM.TorrentManager>) => (manager as any).syncStats() as Promise<void>;

describe('syncStats status mapping', () => {
    // [DB status, Transmission code, percentDone, expected status]
    const cases: [TorrentStatus, number, number, TorrentStatus][] = [
        ['downloading', 4, 0.5, 'downloading'],
        ['downloading', 3, 0.5, 'downloading'],   // dl-wait counts as downloading
        ['downloading', 1, 0.5, 'checking'],
        ['downloading', 2, 1, 'checking'],
        ['downloading', 6, 1, 'seeding'],          // finished + uploading = seeding, no transient completed
        ['seeding', 5, 1, 'seeding'],              // seed-wait counts as seeding
        ['downloading', 0, 0.5, 'paused'],         // stopped before finishing
        ['seeding', 0, 1, 'completed'],            // ratio-limit / external stop when done
        ['completed', 0, 1, 'completed'],          // stable
        ['completed', 6, 1, 'seeding'],            // externally restarted
        ['paused', 4, 0.5, 'downloading'],         // paused records re-converge
        ['paused', 0, 0.5, 'paused'],              // stable
        ['adding', 0, 0, 'adding'],                // held until Transmission starts it
    ];

    it.each(cases)('%s + code %d @ %d → %s', async (dbStatus, code, pct, expected) => {
        insertBasic('t1', { status: dbStatus });
        const manager = managerWith([tRow('t1', { status: code, percentDone: pct })]);
        await sync(manager);
        expect(db.getTorrent('t1')?.status).toBe(expected);
    });

    it('maps Transmission errors to error status with the message', async () => {
        insertBasic('t1');
        const manager = managerWith([tRow('t1', { status: 4, percentDone: 0.5, error: 3, errorString: 'tracker exploded' })]);
        await sync(manager);
        const record = db.getTorrent('t1');
        expect(record?.status).toBe('error');
        expect(record?.errorMessage).toBe('tracker exploded');
    });
});

describe('completion detection', () => {
    it('fires COMPLETED exactly once and lands on seeding, not a transient completed', async () => {
        insertBasic('t1');
        const manager = managerWith([tRow('t1', { status: 6, percentDone: 1 })]);

        await sync(manager);
        expect(db.getTorrent('t1')?.status).toBe('seeding');
        expect(db.getTorrent('t1')?.completedAt).toEqual(expect.any(Number));
        expect(eventsOf(TORRENT_EVENTS.COMPLETED)).toHaveLength(1);

        await sync(manager);
        expect(db.getTorrent('t1')?.status).toBe('seeding');
        expect(eventsOf(TORRENT_EVENTS.COMPLETED)).toHaveLength(1);
    });

    it('does not fire COMPLETED on a ratio-limit auto-stop of an already-announced torrent', async () => {
        insertBasic('t1', { status: 'seeding' });
        db.updateTorrent('t1', { progress: 1, completedAt: 123 });
        const manager = managerWith([tRow('t1', { status: 0, percentDone: 1 })]);
        await sync(manager);
        expect(db.getTorrent('t1')?.status).toBe('completed');
        expect(eventsOf(TORRENT_EVENTS.COMPLETED)).toHaveLength(0);
    });
});

describe('stall detection', () => {
    const sixMinAgo = () => Date.now() - 6 * 60 * 1000;

    it('does not flag a stopped torrent as stalled', async () => {
        insertBasic('t1');
        const manager = managerWith([tRow('t1', { status: 0, percentDone: 0.5, peersConnected: 0 })]);
        (manager as any).stalledTimers.set('hash-t1', sixMinAgo());
        await sync(manager);
        expect(eventsOf(TORRENT_EVENTS.STALLED)).toHaveLength(0);
    });

    it('still flags a running torrent with no peers', async () => {
        insertBasic('t1');
        const manager = managerWith([tRow('t1', { status: 4, percentDone: 0.5, peersConnected: 0 })]);
        (manager as any).stalledTimers.set('hash-t1', sixMinAgo());
        await sync(manager);
        expect(eventsOf(TORRENT_EVENTS.STALLED)).toHaveLength(1);
    });
});

describe('removed detection', () => {
    it('marks missing active records removed but retains stopped finished ones', async () => {
        insertBasic('t1', { status: 'seeding' });
        insertBasic('t2', { status: 'completed' });
        const manager = managerWith([]);
        await sync(manager);
        expect(db.getTorrent('t1')?.status).toBe('removed');
        expect(db.getTorrent('t2')?.status).toBe('completed');
    });
});

describe('pauseTorrent', () => {
    it('pauses an unfinished torrent: paused status, PAUSED only', async () => {
        insertBasic('t1');
        const manager = new TM.TorrentManager();
        await manager.pauseTorrent('t1');
        expect(db.getTorrent('t1')?.status).toBe('paused');
        expect(eventsOf(TORRENT_EVENTS.PAUSED)).toHaveLength(1);
        expect(eventsOf(TORRENT_EVENTS.COMPLETED)).toHaveLength(0);
    });

    it('pauses a finished torrent already announced: completed status, PAUSED only', async () => {
        insertBasic('t1', { status: 'seeding' });
        db.updateTorrent('t1', { progress: 1, completedAt: 123 });
        const manager = new TM.TorrentManager();
        await manager.pauseTorrent('t1');
        expect(db.getTorrent('t1')?.status).toBe('completed');
        expect(db.getTorrent('t1')?.completedAt).toBe(123);
        expect(eventsOf(TORRENT_EVENTS.PAUSED)).toHaveLength(1);
        expect(eventsOf(TORRENT_EVENTS.COMPLETED)).toHaveLength(0);
    });

    it('pauses a finished torrent never announced: completed status, PAUSED + one COMPLETED', async () => {
        insertBasic('t1', { status: 'seeding' });
        db.updateTorrent('t1', { progress: 1 });
        const manager = new TM.TorrentManager();
        await manager.pauseTorrent('t1');
        expect(db.getTorrent('t1')?.status).toBe('completed');
        expect(db.getTorrent('t1')?.completedAt).toEqual(expect.any(Number));
        expect(eventsOf(TORRENT_EVENTS.PAUSED)).toHaveLength(1);
        expect(eventsOf(TORRENT_EVENTS.COMPLETED)).toHaveLength(1);
    });
});

describe('buildTransmissionIdMap', () => {
    it('maps stopped records so resume works after a daemon restart', async () => {
        insertBasic('t1', { status: 'completed' });
        insertBasic('t2', { status: 'paused' });
        const manager = managerWith([
            tRow('t1', { id: 99 }),
            tRow('t2', { id: 42 }),
        ]);
        await (manager as any).buildTransmissionIdMap();
        expect((manager as any).transmissionIds.get('t1')).toBe(99);
        expect((manager as any).transmissionIds.get('t2')).toBe(42);
    });
});
