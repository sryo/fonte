import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

// The database path derives from FONTE_HOME, which @fonte/core resolves once
// at import time (and vi.resetModules does not re-evaluate the built package).
// So: one temp home for the whole file, set before the first dynamic import,
// with a table wipe between tests.
let tmpHome: string;
let db: typeof import('./torrent-db');
let conn: typeof import('./db-connection');

beforeAll(async () => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fonte-torrent-db-test-'));
    process.env.FONTE_HOME = tmpHome;
    db = await import('./torrent-db');
    conn = await import('./db-connection');
    db.initTorrentDb();
});

afterAll(() => {
    db.closeTorrentDb();
    delete process.env.FONTE_HOME;
    fs.rmSync(tmpHome, { recursive: true, force: true });
});

beforeEach(() => {
    conn.getDb().exec('DELETE FROM torrent_files; DELETE FROM torrents;');
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

describe('insertTorrent / getTorrent', () => {
    it('round-trips a torrent with column defaults applied', () => {
        insertBasic('t1', {
            magnetUri: 'magnet:?xt=urn:btih:abc',
            size: 1234,
        });

        expect(fs.existsSync(path.join(tmpHome, 'torrents.db'))).toBe(true);

        const record = db.getTorrent('t1');
        expect(record).toEqual({
            id: 't1',
            infoHash: 'hash-t1',
            name: 'Torrent t1',
            magnetUri: 'magnet:?xt=urn:btih:abc',
            status: 'downloading',
            progress: 0,
            downloadSpeed: 0,
            uploadSpeed: 0,
            downloaded: 0,
            uploaded: 0,
            size: 1234,
            numPeers: 0,
            savePath: '/downloads',
            files: [],
            addedAt: expect.any(Number),
            completedAt: undefined,
            errorMessage: undefined,
            tags: undefined,
            posterUrl: undefined,
        });

        expect(db.getTorrentByHash('hash-t1')).toEqual(record);
        expect(db.getTorrent('missing')).toBeUndefined();
    });
});

describe('getTorrents status filtering', () => {
    it('excludes removed torrents from listings but not from direct lookup', () => {
        insertBasic('t1');
        insertBasic('t2', { status: 'removed' });
        insertBasic('t3', { status: 'completed' });

        const listed = db.getTorrents().map(t => t.id).sort();
        expect(listed).toEqual(['t1', 't3']);

        expect(db.getTorrent('t2')?.status).toBe('removed');
    });

    it('filters by status on top of the removed exclusion', () => {
        insertBasic('t1');
        insertBasic('t2', { status: 'removed' });
        insertBasic('t3', { status: 'completed' });

        expect(db.getTorrents({ status: 'completed' }).map(t => t.id)).toEqual(['t3']);
        // characterizes current behavior: the base WHERE already excludes
        // 'removed', so explicitly filtering for it can never match
        expect(db.getTorrents({ status: 'removed' })).toEqual([]);
    });
});

describe('tags serialization', () => {
    it('stores tags as JSON and revives them as an array', () => {
        insertBasic('t1');
        db.updateTorrent('t1', { tags: ['film', 'watchlist'] });
        expect(db.getTorrent('t1')?.tags).toEqual(['film', 'watchlist']);
    });

    it('returns undefined tags when never set and [] when set empty', () => {
        insertBasic('t1');
        insertBasic('t2');
        db.updateTorrent('t2', { tags: [] });

        expect(db.getTorrent('t1')?.tags).toBeUndefined();
        expect(db.getTorrent('t2')?.tags).toEqual([]);
    });
});

describe('torrent record wire shape', () => {
    it('always returns files: [] even when torrent_files rows exist', () => {
        insertBasic('t1');
        db.insertTorrentFiles('t1', [
            { name: 'a.mkv', path: 'dir/a.mkv', size: 100 },
            { name: 'b.srt', path: 'dir/b.srt', size: 5 },
        ]);

        // characterizes current behavior: files are only exposed through
        // getTorrentFiles, never inlined on the torrent record
        expect(db.getTorrent('t1')?.files).toEqual([]);
        expect(db.getTorrents()[0].files).toEqual([]);

        expect(db.getTorrentFiles('t1')).toEqual([
            { name: 'a.mkv', path: 'dir/a.mkv', size: 100, progress: 0, selected: true },
            { name: 'b.srt', path: 'dir/b.srt', size: 5, progress: 0, selected: true },
        ]);
    });
});
