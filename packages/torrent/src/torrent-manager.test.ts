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
    const seedActivity = (manager: unknown, hash: string, lastDataAt: number) =>
        (manager as any).downloadActivity.set(hash, { downloaded: 0, lastDataAt });

    it('does not flag a stopped torrent as stalled', async () => {
        insertBasic('t1');
        const manager = managerWith([tRow('t1', { status: 0, percentDone: 0.5, peersConnected: 0 })]);
        seedActivity(manager, 'hash-t1', sixMinAgo());
        await sync(manager);
        expect(eventsOf(TORRENT_EVENTS.STALLED)).toHaveLength(0);
        expect(db.getTorrent('t1')?.stalledSince).toBeUndefined();
    });

    it('flags a running torrent receiving no data, once per episode', async () => {
        insertBasic('t1');
        const manager = managerWith([tRow('t1', { status: 4, percentDone: 0.5, peersConnected: 2 })]);
        seedActivity(manager, 'hash-t1', sixMinAgo());
        await sync(manager);
        expect(eventsOf(TORRENT_EVENTS.STALLED)).toHaveLength(1);
        expect(db.getTorrent('t1')?.stalledSince).toEqual(expect.any(Number));

        await sync(manager);
        expect(eventsOf(TORRENT_EVENTS.STALLED)).toHaveLength(1);
    });

    it('does not flag a queue-waiting (dl-wait) torrent as stalled', async () => {
        insertBasic('t1');
        const manager = managerWith([tRow('t1', { status: 3, percentDone: 0.5, peersConnected: 2 })]);
        seedActivity(manager, 'hash-t1', sixMinAgo());
        await sync(manager);
        expect(eventsOf(TORRENT_EVENTS.STALLED)).toHaveLength(0);
        expect(db.getTorrent('t1')?.stalledSince).toBeUndefined();
    });

    it('clears the stall and re-arms when data flows again', async () => {
        insertBasic('t1');
        const manager = managerWith([tRow('t1', { status: 4, percentDone: 0.5, rateDownload: 5000, peersConnected: 2 })]);
        seedActivity(manager, 'hash-t1', sixMinAgo());
        (manager as any).stalledNotified.add('hash-t1');
        await sync(manager);
        expect(eventsOf(TORRENT_EVENTS.STALLED)).toHaveLength(0);
        expect(db.getTorrent('t1')?.stalledSince).toBeUndefined();
        expect((manager as any).stalledNotified.has('hash-t1')).toBe(false);
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

describe('addTorrent duplicate handling', () => {
    const hex = '0123456789abcdef0123456789abcdef01234567';
    const magnet = `magnet:?xt=urn:btih:${hex}&dn=Re-Add+Me`;

    // Fake RPC for the add flow: torrent-add resolves to the real hash,
    // torrent-get returns no files so syncTorrentFiles no-ops.
    function managerWithAdd(hashString: string) {
        const manager = new TM.TorrentManager();
        (manager as any).rpc = {
            call: async (method: string) => {
                if (method === 'torrent-add') return { 'torrent-added': { id: 7, hashString, name: 'Re-Add Me' } };
                if (method === 'torrent-get') return { torrents: [] };
                return {};
            },
        };
        return manager;
    }

    it('re-adds a magnet whose previous record was removed with files kept', async () => {
        const manager = managerWithAdd(hex);
        const first = await manager.addTorrent(magnet, { savePath: '/downloads' });
        await manager.removeTorrent(first.id);
        expect(db.getTorrent(first.id)?.status).toBe('removed');

        const second = await manager.addTorrent(magnet, { savePath: '/downloads' });
        expect(second.id).not.toBe(first.id);
        expect(second.infoHash).toBe(hex);
        expect(second.status).toBe('downloading');
        expect(db.getTorrent(first.id)).toBeUndefined();
        expect(db.getTorrents()).toHaveLength(1);
    });

    it('re-adds via the temp-hash path when the tombstone holds the real hash', async () => {
        const manager = managerWithAdd(hex);
        const first = await manager.addTorrent(magnet, { savePath: '/downloads' });
        await manager.removeTorrent(first.id);

        // A .torrent buffer carries no magnet hash, so the insert runs under
        // a temp hash and only collides at the info-hash update.
        const second = await manager.addTorrent(Buffer.from('d4:infoe'), { savePath: '/downloads' });
        expect(second.infoHash).toBe(hex);
        expect(db.getTorrent(first.id)).toBeUndefined();
        expect(db.getTorrents()).toHaveLength(1);
    });

    it('re-adds a magnet whose previous add failed, replacing the errored row', async () => {
        let failAdds = 1;
        const manager = new TM.TorrentManager();
        (manager as any).rpc = {
            call: async (method: string) => {
                if (method === 'torrent-add') {
                    if (failAdds > 0) {
                        failAdds--;
                        throw new Error("Transmission RPC: Couldn't fetch torrent: Internal Server Error (500)");
                    }
                    return { 'torrent-added': { id: 7, hashString: hex, name: 'Re-Add Me' } };
                }
                if (method === 'torrent-get') return { torrents: [] };
                return {};
            },
        };

        await expect(manager.addTorrent(magnet, { savePath: '/downloads' })).rejects.toThrow(/500/);
        const errored = db.getTorrents({ status: 'error' });
        expect(errored).toHaveLength(1);

        const second = await manager.addTorrent(magnet, { savePath: '/downloads' });
        expect(second.id).not.toBe(errored[0].id);
        expect(second.status).toBe('downloading');
        expect(db.getTorrent(errored[0].id)).toBeUndefined();
        expect(db.getTorrents()).toHaveLength(1);
        expect(db.getTorrents({ status: 'error' })).toHaveLength(0);
    });

    it('re-adds via the temp-hash path when the errored row holds the real hash', async () => {
        insertBasic('stale', { infoHash: hex, status: 'error' });

        const manager = managerWithAdd(hex);
        const second = await manager.addTorrent(Buffer.from('d4:infoe'), { savePath: '/downloads' });
        expect(second.infoHash).toBe(hex);
        expect(db.getTorrent('stale')).toBeUndefined();
        expect(db.getTorrents()).toHaveLength(1);
        expect(db.getTorrents({ status: 'error' })).toHaveLength(0);
    });

    it('still rejects a duplicate of an active record', async () => {
        const manager = managerWithAdd(hex);
        await manager.addTorrent(magnet, { savePath: '/downloads' });
        await expect(manager.addTorrent(magnet, { savePath: '/downloads' })).rejects.toThrow(/already exists/);
        expect(db.getTorrents()).toHaveLength(1);
    });

    it('rejects a temp-hash duplicate of an active record without leaving a junk row', async () => {
        const manager = managerWithAdd(hex);
        await manager.addTorrent(magnet, { savePath: '/downloads' });
        await expect(manager.addTorrent(Buffer.from('d4:infoe'), { savePath: '/downloads' })).rejects.toThrow(/already exists/);
        expect(db.getTorrents()).toHaveLength(1);
        expect(db.getTorrents({ status: 'error' })).toHaveLength(0);
    });

    it('recovers a nameless magnet add that a sync pass marked removed mid-flight', async () => {
        const manager = new TM.TorrentManager();
        (manager as any).rpc = {
            call: async (method: string) => {
                if (method === 'torrent-add') {
                    // Simulate the reconciliation race: syncStats sees the
                    // fresh 'adding' row missing from Transmission and marks
                    // it removed while torrent-add is still in flight; the add
                    // then resolves without a name (magnet metadata pending).
                    const row = db.getTorrents({ status: 'adding' })[0];
                    if (row) db.updateTorrent(row.id, { status: 'removed' });
                    return { 'torrent-added': { id: 9, hashString: hex, name: '' } };
                }
                if (method === 'torrent-get') return { torrents: [] };
                return {};
            },
        };

        const rec = await manager.addTorrent(magnet, { savePath: '/downloads' });
        expect(db.getTorrent(rec.id)?.status).toBe('downloading');
    });

    // Records torrent-add args so we can assert what actually reached Transmission.
    function recordingManager(calls: { method: string; args: any }[]) {
        const manager = new TM.TorrentManager();
        (manager as any).rpc = {
            call: async (method: string, args: any) => {
                calls.push({ method, args });
                if (method === 'torrent-add') return { 'torrent-added': { id: 7, hashString: hex, name: 'Linked' } };
                if (method === 'torrent-get') return { torrents: [] };
                return {};
            },
        };
        return manager;
    }

    it('resolves an HTTP release link to a magnet before adding, not the raw URL', async () => {
        const calls: { method: string; args: any }[] = [];
        const manager = recordingManager(calls);
        vi.stubGlobal('fetch', vi.fn(async () => ({
            status: 302, ok: false,
            headers: { get: (k: string) => (k.toLowerCase() === 'location' ? magnet : null) },
            body: { cancel: async () => {} },
            arrayBuffer: async () => new ArrayBuffer(0),
        })));

        await manager.addTorrent('https://jackett.test/dl/token', { savePath: '/downloads' });

        const add = calls.find(c => c.method === 'torrent-add')!;
        expect(add.args.filename).toBe(magnet);
        expect(add.args.metainfo).toBeUndefined();
        vi.unstubAllGlobals();
    });

    it('downloads a .torrent link and adds it as metainfo', async () => {
        const bytes = Buffer.from('d8:announce9:track.url4:infod6:lengthi1eee');
        const calls: { method: string; args: any }[] = [];
        const manager = recordingManager(calls);
        vi.stubGlobal('fetch', vi.fn(async () => ({
            status: 200, ok: true,
            headers: { get: () => null },
            body: { cancel: async () => {} },
            arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        })));

        await manager.addTorrent('https://jackett.test/dl/token.torrent', { savePath: '/downloads' });

        const add = calls.find(c => c.method === 'torrent-add')!;
        expect(add.args.metainfo).toBe(bytes.toString('base64'));
        expect(add.args.filename).toBeUndefined();
        vi.unstubAllGlobals();
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
