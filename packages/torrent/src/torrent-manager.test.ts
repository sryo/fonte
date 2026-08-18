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
let subs: typeof import('./subtitle-db');
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
    subs = await import('./subtitle-db');
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
        ['downloading', 3, 0.5, 'queued'],         // dl-wait = waiting for a download slot
        ['queued', 4, 0.5, 'downloading'],         // slot freed up
        ['queued', 0, 0.5, 'paused'],              // stopped while waiting
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

    it('fires COMPLETED for a torrent that finishes straight out of the queue', async () => {
        insertBasic('t1', { status: 'queued' });
        const manager = managerWith([tRow('t1', { status: 6, percentDone: 1 })]);
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

    const hasTrash = fs.existsSync('/usr/bin/trash');

    it.runIf(hasTrash)('moves sidecar subtitle files to the Trash when removing with deleteFiles', async () => {
        const manager = managerWithAdd(hex);
        const torrent = await manager.addTorrent(magnet, { savePath: tmpHome });
        const srt = path.join(tmpHome, 'sidecar.en.srt');
        fs.writeFileSync(srt, '1\n00:00:01,000 --> 00:00:02,000\nhi\n');
        subs.insertSubtitle({ torrentId: torrent.id, filePath: srt, language: 'en', isOriginal: true });

        await manager.removeTorrent(torrent.id, true);

        // Trashed: gone from its source path, and the DB row is hard-deleted.
        expect(fs.existsSync(srt)).toBe(false);
        expect(db.getTorrent(torrent.id)).toBeUndefined();
    });

    it('keeps sidecar subtitle files when removing without deleteFiles', async () => {
        const manager = managerWithAdd(hex);
        const torrent = await manager.addTorrent(magnet, { savePath: '/downloads' });
        const srt = path.join(tmpHome, 'sidecar-kept.en.srt');
        fs.writeFileSync(srt, '1\n00:00:01,000 --> 00:00:02,000\nhi\n');
        subs.insertSubtitle({ torrentId: torrent.id, filePath: srt, language: 'en', isOriginal: true });

        await manager.removeTorrent(torrent.id, false);

        expect(fs.existsSync(srt)).toBe(true);
        expect(db.getTorrent(torrent.id)?.status).toBe('removed');
        fs.unlinkSync(srt);
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

describe('queue and priority', () => {
    function managerWithCalls(response: (method: string, args: any) => any) {
        const calls: { method: string; args: any }[] = [];
        const manager = new TM.TorrentManager();
        (manager as any).rpc = {
            call: async (method: string, args: any) => {
                calls.push({ method, args });
                return response(method, args);
            },
        };
        (manager as any).transmissionIds.set('t1', 1);
        return { manager, calls };
    }

    it('persists queuePosition and bandwidthPriority from syncStats', async () => {
        insertBasic('t1');
        const manager = managerWith([tRow('t1', { status: 4, percentDone: 0.5, queuePosition: 2, bandwidthPriority: 1 })]);
        await sync(manager);

        const record = db.getTorrent('t1');
        expect(record?.queuePosition).toBe(2);
        expect(record?.bandwidthPriority).toBe(1);
    });

    it('moveInQueue maps directions to queue-move-* and positions to torrent-set, then re-reads positions', async () => {
        insertBasic('t1');
        const { manager, calls } = managerWithCalls(() => ({
            torrents: [{ id: 1, hashString: 'hash-t1', queuePosition: 0 }],
        }));

        await manager.moveInQueue('t1', 'top');
        expect(calls[0]).toEqual({ method: 'queue-move-top', args: { ids: [1] } });
        expect(calls[1].method).toBe('torrent-get');
        expect(db.getTorrent('t1')?.queuePosition).toBe(0);

        await manager.moveInQueue('t1', 4);
        expect(calls[2]).toEqual({ method: 'torrent-set', args: { ids: [1], queuePosition: 4 } });
    });

    it('setFilePriority maps tiers to Transmission args and re-syncs file rows', async () => {
        insertBasic('t1');
        db.insertTorrentFiles('t1', [{ name: 'a.mkv', path: 'a.mkv', size: 100 }]);
        const { manager, calls } = managerWithCalls((method) =>
            method === 'torrent-get'
                ? { torrents: [{ files: [{ name: 'a.mkv', length: 100, bytesCompleted: 0 }], fileStats: [{ wanted: true, priority: 1 }] }] }
                : {});

        await manager.setFilePriority('t1', [0], 1);
        expect(calls[0]).toEqual({ method: 'torrent-set', args: { ids: [1], 'priority-high': [0] } });
        expect(db.getTorrentFiles('t1')[0].priority).toBe(1);

        await manager.setFilePriority('t1', [0], -1);
        expect(calls[2]).toEqual({ method: 'torrent-set', args: { ids: [1], 'priority-low': [0] } });
    });

    it('setBandwidthPriority writes through to the record', async () => {
        insertBasic('t1');
        const { manager, calls } = managerWithCalls(() => ({}));

        await manager.setBandwidthPriority('t1', -1);
        expect(calls[0]).toEqual({ method: 'torrent-set', args: { ids: [1], bandwidthPriority: -1 } });
        expect(db.getTorrent('t1')?.bandwidthPriority).toBe(-1);
    });
});

describe('getPieces', () => {
    function piecesManager(response: (method: string, args: any) => any, mapped = true) {
        const calls: { method: string; args: any }[] = [];
        const manager = new TM.TorrentManager();
        (manager as any).rpc = {
            call: async (method: string, args: any) => {
                calls.push({ method, args });
                return response(method, args);
            },
        };
        if (mapped) (manager as any).transmissionIds.set('t1', 1);
        return { manager, calls };
    }

    it('fetches the bitfield and piece count for a mapped torrent', async () => {
        insertBasic('t1');
        const { manager, calls } = piecesManager(() => ({
            torrents: [{ pieces: '/wA=', pieceCount: 16 }],
        }));

        const pieces = await manager.getPieces('t1');

        expect(pieces).toEqual({ bitfield: '/wA=', count: 16 });
        expect(calls[0]).toEqual({
            method: 'torrent-get',
            args: { ids: [1], fields: ['pieces', 'pieceCount'] },
        });
    });

    it('returns null when the torrent has no transmission mapping', async () => {
        insertBasic('t1');
        const { manager, calls } = piecesManager(() => ({}), false);

        expect(await manager.getPieces('t1')).toBeNull();
        expect(calls).toHaveLength(0);
    });

    it('returns null when the RPC call fails', async () => {
        insertBasic('t1');
        const { manager } = piecesManager(() => {
            throw new Error('daemon gone');
        });

        expect(await manager.getPieces('t1')).toBeNull();
    });

    it('returns null when Transmission omits the fields', async () => {
        insertBasic('t1');
        const { manager } = piecesManager(() => ({ torrents: [{}] }));

        expect(await manager.getPieces('t1')).toBeNull();
    });

    it('throws for an unknown torrent id', async () => {
        const { manager } = piecesManager(() => ({}));

        await expect(manager.getPieces('nope')).rejects.toThrow('Torrent not found');
    });
});
