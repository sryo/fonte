/**
 * Versioned SQLite schema migrations keyed on PRAGMA user_version, with a
 * snapshot of the database taken before any pending migration touches it.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

export interface Migration {
    version: number;
    name: string;
    up(db: Database.Database): void;
}

export interface MigrateOptions {
    dbPath: string;
    backupDir: string;
    keepBackups?: number;
    log?: (level: string, message: string) => void;
}

export interface MigrateResult {
    from: number;
    to: number;
    backupPath: string | null;
}

const JOURNAL_SIZE_LIMIT = 64 * 1024 * 1024;

export function applyPragmas(db: Database.Database, opts: { foreignKeys?: boolean } = {}): void {
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    db.pragma('synchronous = NORMAL');
    db.pragma('checkpoint_fullfsync = ON');
    db.pragma(`journal_size_limit = ${JOURNAL_SIZE_LIMIT}`);
    if (opts.foreignKeys) db.pragma('foreign_keys = ON');
}

// optimize first: it may run ANALYZE, which writes to the WAL the checkpoint then empties.
export function maintainDb(db: Database.Database): void {
    db.pragma('optimize');
    db.pragma('wal_checkpoint(TRUNCATE)');
}

/**
 * Synchronous so the existing sync init functions can call it. The backup is
 * VACUUM INTO, not db.backup(), because the latter is async.
 */
export function runMigrations(db: Database.Database, migrations: Migration[], opts: MigrateOptions): MigrateResult {
    migrations.forEach((m, i) => {
        if (m.version !== i + 1) {
            throw new Error(`Migration "${m.name}" has version ${m.version}; expected ${i + 1} (versions run 1, 2, 3 in order)`);
        }
    });

    const dbName = path.basename(opts.dbPath, path.extname(opts.dbPath));
    const say = (level: string, message: string) => {
        try { opts.log?.(level, message); } catch { /* a committed migration must not look failed */ }
    };
    const latest = migrations.length;
    const from = db.pragma('user_version', { simple: true }) as number;

    if (from > latest) {
        throw new Error(
            `${path.basename(opts.dbPath)} is at schema version ${from} but this build only knows up to ${latest}. ` +
            `A newer Fonte build migrated it; update Fonte, or restore a backup from ${opts.backupDir}.`
        );
    }
    if (from === latest) return { from, to: from, backupPath: null };

    const backupPath = from > 0 || hasUserTables(db) ? backup(db, dbName, from, opts, say) : null;

    for (const m of migrations.slice(from)) {
        try {
            db.transaction(() => {
                m.up(db);
                db.pragma(`user_version = ${m.version}`);
            }).immediate();
        } catch (err) {
            say('ERROR', `${dbName}: migration v${m.version} (${m.name}) failed: ${(err as Error).message}`);
            throw err;
        }
        say('INFO', `${dbName}: applied migration v${m.version} (${m.name})`);
    }
    return { from, to: latest, backupPath };
}

function hasUserTables(db: Database.Database): boolean {
    return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' LIMIT 1").get();
}

function backup(
    db: Database.Database, dbName: string, from: number, opts: MigrateOptions,
    say: (level: string, message: string) => void,
): string {
    fs.mkdirSync(opts.backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    let target = path.join(opts.backupDir, `${dbName}-v${from}-${stamp}.db`);
    for (let n = 1; fs.existsSync(target); n++) {
        target = path.join(opts.backupDir, `${dbName}-v${from}-${stamp}-${n}.db`);
    }
    db.prepare('VACUUM INTO ?').run(target);
    say('INFO', `${dbName}: backed up schema v${from} to ${target}`);
    pruneBackups(dbName, opts);
    return target;
}

function pruneBackups(dbName: string, opts: MigrateOptions): void {
    const keep = opts.keepBackups ?? 3;
    const escaped = dbName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^${escaped}-v(\\d+)-(.+)\\.db$`);
    const ours = fs.readdirSync(opts.backupDir)
        .map(file => ({ file, m: file.match(pattern) }))
        .filter((e): e is { file: string; m: RegExpMatchArray } => !!e.m)
        .sort((a, b) => a.m[2] === b.m[2] ? Number(a.m[1]) - Number(b.m[1]) : a.m[2] < b.m[2] ? -1 : 1);
    for (const { file } of ours.slice(0, Math.max(0, ours.length - keep))) {
        fs.rmSync(path.join(opts.backupDir, file), { force: true });
    }
}
