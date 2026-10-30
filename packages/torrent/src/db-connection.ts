import Database from 'better-sqlite3';
import path from 'path';
import { FONTE_HOME, applyPragmas, maintainDb } from '@fonte/core';

const DB_PATH = path.join(FONTE_HOME, 'torrents.db');

let db: Database.Database | null = null;

export function initDb(): Database.Database {
    if (db) return db;
    db = new Database(DB_PATH);
    applyPragmas(db, { foreignKeys: true });
    return db;
}

export function getDb(): Database.Database {
    if (!db) throw new Error('DB not initialized. Call initTorrentDb() first.');
    return db;
}

export function maintainTorrentDb(): void {
    if (db) maintainDb(db);
}

export function closeDb(): void {
    if (db) {
        db.close();
        db = null;
    }
}
