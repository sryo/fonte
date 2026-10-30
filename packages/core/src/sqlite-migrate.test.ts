import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runMigrations, applyPragmas, maintainDb, Migration } from './sqlite-migrate';

let dir: string;
let backupDir: string;
let dbPath: string;
let db: Database.Database;

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fonte-migrate-test-'));
    backupDir = path.join(dir, 'backups');
    dbPath = path.join(dir, 'app.db');
    db = new Database(dbPath);
});

afterEach(() => {
    if (db.open) db.close();
    fs.rmSync(dir, { recursive: true, force: true });
});

const version = (d = db) => d.pragma('user_version', { simple: true }) as number;
const backups = () => fs.existsSync(backupDir) ? fs.readdirSync(backupDir).sort() : [];
const tables = (d = db) => (d.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
).all() as { name: string }[]).map(r => r.name);

function makeMigrations(n: number, ran: number[] = []): Migration[] {
    return Array.from({ length: n }, (_, i) => ({
        version: i + 1,
        name: `create t${i + 1}`,
        up: (d: Database.Database) => { ran.push(i + 1); d.exec(`CREATE TABLE t${i + 1} (x INTEGER)`); },
    }));
}

describe('runMigrations', () => {
    it('runs every migration on a fresh database without a backup', () => {
        const ran: number[] = [];
        const result = runMigrations(db, makeMigrations(3, ran), { dbPath, backupDir });
        expect(ran).toEqual([1, 2, 3]);
        expect(version()).toBe(3);
        expect(tables()).toEqual(['t1', 't2', 't3']);
        expect(result).toEqual({ from: 0, to: 3, backupPath: null });
        expect(backups()).toEqual([]);
    });

    it('backs up a version-0 database that already holds tables before migrating it', () => {
        db.exec("CREATE TABLE legacy (v TEXT); INSERT INTO legacy VALUES ('kept')");
        const result = runMigrations(db, makeMigrations(1), { dbPath, backupDir });
        expect(version()).toBe(1);
        expect(backups()).toHaveLength(1);
        expect(backups()[0]).toMatch(/^app-v0-.+\.db$/);
        expect(result.backupPath).toBe(path.join(backupDir, backups()[0]));

        const copy = new Database(result.backupPath!, { readonly: true });
        expect(version(copy)).toBe(0);
        expect(tables(copy)).toEqual(['legacy']);
        expect(copy.prepare('SELECT v FROM legacy').get()).toEqual({ v: 'kept' });
        copy.close();
    });

    it('backs up from the current version when only newer migrations are pending', () => {
        runMigrations(db, makeMigrations(1), { dbPath, backupDir });
        const ran: number[] = [];
        runMigrations(db, makeMigrations(2, ran), { dbPath, backupDir });
        expect(ran).toEqual([2]);
        expect(version()).toBe(2);
        expect(backups()).toHaveLength(1);
        expect(backups()[0]).toMatch(/^app-v1-/);
    });

    it('does nothing to an up-to-date database', () => {
        runMigrations(db, makeMigrations(2), { dbPath, backupDir });
        const ran: number[] = [];
        const result = runMigrations(db, makeMigrations(2, ran), { dbPath, backupDir });
        expect(ran).toEqual([]);
        expect(result).toEqual({ from: 2, to: 2, backupPath: null });
        expect(backups()).toEqual([]);
    });

    it('rolls back a failing migration, keeps the last good version, and rethrows', () => {
        const migrations: Migration[] = [
            ...makeMigrations(1),
            {
                version: 2, name: 'half done',
                up: d => { d.exec('CREATE TABLE half (x)'); throw new Error('boom'); },
            },
            { version: 3, name: 'never', up: d => d.exec('CREATE TABLE never (x)') },
        ];
        expect(() => runMigrations(db, migrations, { dbPath, backupDir })).toThrow(/boom/);
        expect(version()).toBe(1);
        expect(tables()).toEqual(['t1']);
    });

    it('logs each applied migration and the failing one', () => {
        const lines: string[] = [];
        const log = (level: string, msg: string) => lines.push(`${level} ${msg}`);
        const migrations: Migration[] = [
            ...makeMigrations(1),
            { version: 2, name: 'bad', up: () => { throw new Error('nope'); } },
        ];
        expect(() => runMigrations(db, migrations, { dbPath, backupDir, log })).toThrow();
        expect(lines.some(l => l.startsWith('INFO') && l.includes('v1') && l.includes('create t1'))).toBe(true);
        expect(lines.some(l => l.startsWith('ERROR') && l.includes('v2') && l.includes('nope'))).toBe(true);
    });

    it('finishes migrating when the logger itself throws', () => {
        db.exec('CREATE TABLE seed (x)');
        const log = () => { throw new Error('log file missing'); };
        expect(runMigrations(db, makeMigrations(2), { dbPath, backupDir, log })).toMatchObject({ from: 0, to: 2 });
        expect(version()).toBe(2);
    });

    it('refuses a database migrated by a newer build', () => {
        db.pragma('user_version = 5');
        db.exec('CREATE TABLE future (x)');
        const ran: number[] = [];
        expect(() => runMigrations(db, makeMigrations(3, ran), { dbPath, backupDir }))
            .toThrow(/app\.db.*version 5.*3/);
        expect(ran).toEqual([]);
        expect(version()).toBe(5);
        expect(backups()).toEqual([]);
    });

    it('rejects migrations that are not numbered 1, 2, 3 in order', () => {
        const bad: Migration[] = [
            { version: 1, name: 'a', up: () => {} },
            { version: 3, name: 'b', up: () => {} },
        ];
        expect(() => runMigrations(db, bad, { dbPath, backupDir })).toThrow(/version/);
        expect(version()).toBe(0);
    });

    it('keeps only the newest backups for this database name', () => {
        db.exec('CREATE TABLE seed (x)');
        fs.mkdirSync(backupDir, { recursive: true });
        fs.writeFileSync(path.join(backupDir, 'other-v0-2000-01-01T00-00-00-000Z.db'), '');
        for (let n = 1; n <= 5; n++) {
            runMigrations(db, makeMigrations(n), { dbPath, backupDir });
        }
        const mine = backups().filter(f => f.startsWith('app-'));
        expect(mine.map(f => f.match(/^app-v(\d+)-/)![1])).toEqual(['2', '3', '4']);
        expect(backups()).toContain('other-v0-2000-01-01T00-00-00-000Z.db');
    });

    it('honours a custom keepBackups', () => {
        db.exec('CREATE TABLE seed (x)');
        for (let n = 1; n <= 3; n++) {
            runMigrations(db, makeMigrations(n), { dbPath, backupDir, keepBackups: 1 });
        }
        expect(backups()).toHaveLength(1);
        expect(backups()[0]).toMatch(/^app-v2-/);
    });
});

describe('applyPragmas', () => {
    it('sets WAL, timeouts, sync level and journal limit', () => {
        const driverDefault = db.pragma('foreign_keys', { simple: true });
        applyPragmas(db);
        expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
        expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
        expect(db.pragma('synchronous', { simple: true })).toBe(1);
        expect(db.pragma('checkpoint_fullfsync', { simple: true })).toBe(1);
        expect(db.pragma('journal_size_limit', { simple: true })).toBe(64 * 1024 * 1024);
        expect(db.pragma('foreign_keys', { simple: true })).toBe(driverDefault);
    });

    it('turns on foreign keys when asked', () => {
        db.pragma('foreign_keys = OFF');
        applyPragmas(db, { foreignKeys: true });
        expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    });
});

describe('maintainDb', () => {
    it('checkpoints the WAL down to zero bytes', () => {
        applyPragmas(db);
        db.exec('CREATE TABLE t (x); CREATE INDEX t_x ON t(x)');
        const insert = db.prepare('INSERT INTO t VALUES (?)');
        for (let i = 0; i < 200; i++) insert.run(i % 7);
        db.prepare('SELECT COUNT(*) FROM t WHERE x = 3').get();
        expect(fs.statSync(`${dbPath}-wal`).size).toBeGreaterThan(0);
        maintainDb(db);
        expect(fs.statSync(`${dbPath}-wal`).size).toBe(0);
        expect(db.prepare('SELECT COUNT(*) AS c FROM t').get()).toEqual({ c: 200 });
    });
});
