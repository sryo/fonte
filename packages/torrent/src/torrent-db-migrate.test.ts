import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

let tmpHome: string;
let dbPath: string;
let backupDir: string;
let db: typeof import('./torrent-db');
let conn: typeof import('./db-connection');

beforeAll(async () => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fonte-torrent-migrate-test-'));
    process.env.FONTE_HOME = tmpHome;
    dbPath = path.join(tmpHome, 'torrents.db');
    backupDir = path.join(tmpHome, 'backups');
    db = await import('./torrent-db');
    conn = await import('./db-connection');
});

afterAll(() => {
    db.closeTorrentDb();
    delete process.env.FONTE_HOME;
    fs.rmSync(tmpHome, { recursive: true, force: true });
});

beforeEach(() => {
    for (const f of ['torrents.db', 'torrents.db-wal', 'torrents.db-shm']) fs.rmSync(path.join(tmpHome, f), { force: true });
    fs.rmSync(backupDir, { recursive: true, force: true });
});

afterEach(() => db.closeTorrentDb());

const columns = (d: Database.Database, table: string) =>
    (d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(c => c.name);
const backups = () => fs.existsSync(backupDir) ? fs.readdirSync(backupDir) : [];
const HASH = 'a'.repeat(40);

function buildLegacyDb(): void {
    const d = new Database(dbPath);
    d.exec(`
        CREATE TABLE torrents (
            id TEXT PRIMARY KEY, info_hash TEXT NOT NULL UNIQUE, name TEXT NOT NULL DEFAULT '',
            magnet_uri TEXT, status TEXT NOT NULL DEFAULT 'adding', progress REAL NOT NULL DEFAULT 0,
            download_speed REAL NOT NULL DEFAULT 0, upload_speed REAL NOT NULL DEFAULT 0,
            downloaded INTEGER NOT NULL DEFAULT 0, uploaded INTEGER NOT NULL DEFAULT 0,
            size INTEGER NOT NULL DEFAULT 0, num_peers INTEGER NOT NULL DEFAULT 0,
            save_path TEXT NOT NULL, tags TEXT, error_message TEXT,
            added_at INTEGER NOT NULL, completed_at INTEGER, updated_at INTEGER NOT NULL
        );
        CREATE TABLE torrent_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT, torrent_id TEXT NOT NULL, name TEXT NOT NULL,
            path TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0, progress REAL NOT NULL DEFAULT 0,
            selected INTEGER NOT NULL DEFAULT 1,
            FOREIGN KEY (torrent_id) REFERENCES torrents(id) ON DELETE CASCADE
        );
        CREATE TABLE watchlist (
            id TEXT PRIMARY KEY, title TEXT NOT NULL, media_type TEXT NOT NULL DEFAULT 'movie',
            year INTEGER, season_pattern TEXT, quality TEXT NOT NULL DEFAULT '1080p',
            search_query TEXT NOT NULL, category INTEGER NOT NULL DEFAULT 2000,
            enabled INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'watching',
            last_checked_at INTEGER, last_match_at INTEGER, matched_torrent_id TEXT,
            created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
        CREATE TABLE watchlist_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT, watchlist_id TEXT NOT NULL, title TEXT NOT NULL,
            magnet_uri TEXT NOT NULL, seeders INTEGER DEFAULT 0, leechers INTEGER DEFAULT 0,
            size INTEGER DEFAULT 0, quality_match REAL DEFAULT 0, publish_date INTEGER, indexer TEXT,
            was_selected INTEGER DEFAULT 0, found_at INTEGER NOT NULL,
            FOREIGN KEY (watchlist_id) REFERENCES watchlist(id) ON DELETE CASCADE
        );
        CREATE TABLE automation_rules (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '',
            trigger_type TEXT NOT NULL, trigger_config TEXT DEFAULT '{}', conditions TEXT DEFAULT '[]',
            actions TEXT DEFAULT '[]', enabled INTEGER NOT NULL DEFAULT 1, last_triggered_at INTEGER,
            trigger_count INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
        INSERT INTO torrents (id, info_hash, name, status, save_path, added_at, updated_at)
            VALUES ('t1', '${HASH}', 'Old+Name', 'seeding', '/dl', 1, 1);
        INSERT INTO torrent_files (torrent_id, name, path, size) VALUES ('t1', 'f.mkv', 'f.mkv', 10);
        INSERT INTO watchlist (id, title, search_query, created_at, updated_at) VALUES ('w1', 'Show', 'show', 1, 1);
        INSERT INTO watchlist_results (watchlist_id, title, magnet_uri, found_at)
            VALUES ('w1', 'Show S01', 'magnet:?xt=urn:btih:${HASH}', 42);
    `);
    d.close();
}

function inspect<T>(fn: (d: Database.Database) => T): T {
    db.closeTorrentDb();
    const d = new Database(dbPath, { readonly: true });
    try { return fn(d); } finally { d.close(); }
}

describe('torrents.db migrations', () => {
    it('creates the current schema on a fresh install with no backup', () => {
        db.initTorrentDb();
        expect(conn.getDb().pragma('foreign_keys', { simple: true })).toBe(1);
        expect(conn.getDb().pragma('journal_mode', { simple: true })).toBe('wal');
        const s = inspect(d => ({
            version: d.pragma('user_version', { simple: true }) as number,
            runs: columns(d, 'automation_runs'),
            torrents: columns(d, 'torrents'),
        }));
        expect(s.version).toBeGreaterThanOrEqual(1);
        expect(s.runs).toContain('message_id');
        expect(s.torrents).toEqual(expect.arrayContaining(['poster_url', 'queue_position', 'trackers_total']));
        expect(backups()).toEqual([]);
    });

    it('brings a pre-versioning database to the current shape, keeps its rows, and backs it up first', () => {
        buildLegacyDb();
        db.initTorrentDb();

        expect(db.getTorrent('t1')).toMatchObject({ name: 'Old Name', status: 'seeding', bandwidthPriority: 0 });
        expect(db.getTorrentFiles('t1')).toMatchObject([{ path: 'f.mkv', priority: 0 }]);

        const s = inspect(d => ({
            result: d.prepare('SELECT info_hash, first_found_at, feedback, auto_blocked FROM watchlist_results').get(),
            watchlist: columns(d, 'watchlist'),
            rules: columns(d, 'automation_rules'),
            tables: (d.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(r => r.name),
        }));
        expect(s.result).toEqual({ info_hash: HASH, first_found_at: 42, feedback: 0, auto_blocked: 0 });
        expect(s.watchlist).toEqual(expect.arrayContaining(['poster_url', 'results_viewed_at', 'last_error', 'last_error_at', 'fail_count']));
        expect(s.rules).toEqual(expect.arrayContaining(['prompt', 'trigger', 'agent_id']));
        expect(s.tables).toEqual(expect.arrayContaining(['automation_runs', 'automation_logs', 'torrent_subtitles']));

        const files = backups();
        expect(files).toHaveLength(1);
        expect(files[0]).toMatch(/^torrents-v0-.+\.db$/);
        const copy = new Database(path.join(backupDir, files[0]), { readonly: true });
        expect(columns(copy, 'torrents')).not.toContain('poster_url');
        expect(copy.prepare('SELECT name FROM torrents').get()).toEqual({ name: 'Old+Name' });
        copy.close();
    });

    it('opens an up-to-date database without backing it up', () => {
        db.initTorrentDb();
        db.closeTorrentDb();
        db.initTorrentDb();
        expect(backups()).toEqual([]);
    });

    it('refuses a database left by a newer build', () => {
        const d = new Database(dbPath);
        d.exec('CREATE TABLE torrents (id TEXT)');
        d.pragma('user_version = 999');
        d.close();
        expect(() => db.initTorrentDb()).toThrow(/torrents\.db.*999/);
        expect(() => conn.getDb()).toThrow(/not initialized/);
        expect(backups()).toEqual([]);
    });

    it('checkpoints the WAL on maintenance', () => {
        db.initTorrentDb();
        db.insertTorrent({ id: 't2', infoHash: 'b'.repeat(40), name: 'n', status: 'downloading', savePath: '/dl' });
        conn.maintainTorrentDb();
        expect(fs.statSync(`${dbPath}-wal`).size).toBe(0);
    });
});
