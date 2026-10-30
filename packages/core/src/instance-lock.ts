import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

let held: Database.Database | null = null;

/**
 * Exclusive SQLite lock held for the life of the process; the OS drops it
 * even on SIGKILL. Retries for `waitMs` so a restart can overlap the old
 * process's teardown. Returns false when another live process holds it.
 */
export function acquireInstanceLock(file: string, waitMs = 0): boolean {
    if (held) return true;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const deadline = Date.now() + waitMs;
    const sleeper = new Int32Array(new SharedArrayBuffer(4));
    for (;;) {
        const db = new Database(file);
        try {
            db.pragma('busy_timeout = 0');
            db.pragma('locking_mode = EXCLUSIVE');
            db.exec('BEGIN EXCLUSIVE');
            held = db;
            return true;
        } catch (err) {
            db.close();
            if ((err as { code?: string }).code !== 'SQLITE_BUSY') throw err;
            if (Date.now() >= deadline) return false;
            Atomics.wait(sleeper, 0, 0, 250);
        }
    }
}

export function releaseInstanceLock(): void {
    held?.close();
    held = null;
}
