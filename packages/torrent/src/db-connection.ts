import Database from 'better-sqlite3';
import path from 'path';
import { AITORRENT_HOME } from '@aitorrent/core';

const DB_PATH = path.join(AITORRENT_HOME, 'torrents.db');

let db: Database.Database | null = null;

export function initDb(): Database.Database {
    if (db) return db;
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    db.pragma('foreign_keys = ON');
    return db;
}

export function getDb(): Database.Database {
    if (!db) throw new Error('DB not initialized. Call initTorrentDb() first.');
    return db;
}

export function closeDb(): void {
    if (db) {
        db.close();
        db = null;
    }
}
