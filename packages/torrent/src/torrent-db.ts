import { TorrentStatus, TorrentRecord, TorrentFileRecord } from './types';
import { initDb, getDb, closeDb } from './db-connection';

export function initTorrentDb(): void {
    const db = initDb();

    db.exec(`
        CREATE TABLE IF NOT EXISTS torrents (
            id TEXT PRIMARY KEY,
            info_hash TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL DEFAULT '',
            magnet_uri TEXT,
            status TEXT NOT NULL DEFAULT 'adding',
            progress REAL NOT NULL DEFAULT 0,
            download_speed REAL NOT NULL DEFAULT 0,
            upload_speed REAL NOT NULL DEFAULT 0,
            downloaded INTEGER NOT NULL DEFAULT 0,
            uploaded INTEGER NOT NULL DEFAULT 0,
            size INTEGER NOT NULL DEFAULT 0,
            num_peers INTEGER NOT NULL DEFAULT 0,
            save_path TEXT NOT NULL,
            tags TEXT,
            error_message TEXT,
            added_at INTEGER NOT NULL,
            completed_at INTEGER,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS torrent_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            torrent_id TEXT NOT NULL,
            name TEXT NOT NULL,
            path TEXT NOT NULL,
            size INTEGER NOT NULL DEFAULT 0,
            progress REAL NOT NULL DEFAULT 0,
            selected INTEGER NOT NULL DEFAULT 1,
            FOREIGN KEY (torrent_id) REFERENCES torrents(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_torrents_status ON torrents(status);
        CREATE INDEX IF NOT EXISTS idx_torrents_info_hash ON torrents(info_hash);
        CREATE INDEX IF NOT EXISTS idx_torrent_files_torrent ON torrent_files(torrent_id);

        CREATE TABLE IF NOT EXISTS watchlist (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            media_type TEXT NOT NULL DEFAULT 'movie',
            year INTEGER,
            season_pattern TEXT,
            quality TEXT NOT NULL DEFAULT '1080p',
            search_query TEXT NOT NULL,
            category INTEGER NOT NULL DEFAULT 2000,
            enabled INTEGER NOT NULL DEFAULT 1,
            status TEXT NOT NULL DEFAULT 'watching',
            last_checked_at INTEGER,
            last_match_at INTEGER,
            matched_torrent_id TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_watchlist_status ON watchlist(status, enabled);

        CREATE TABLE IF NOT EXISTS watchlist_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            watchlist_id TEXT NOT NULL,
            title TEXT NOT NULL,
            magnet_uri TEXT NOT NULL,
            seeders INTEGER DEFAULT 0,
            leechers INTEGER DEFAULT 0,
            size INTEGER DEFAULT 0,
            quality_match REAL DEFAULT 0,
            publish_date INTEGER,
            indexer TEXT,
            was_selected INTEGER DEFAULT 0,
            found_at INTEGER NOT NULL,
            FOREIGN KEY (watchlist_id) REFERENCES watchlist(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_wl_results_watchlist ON watchlist_results(watchlist_id);

        CREATE TABLE IF NOT EXISTS torrent_subtitles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            torrent_id TEXT NOT NULL,
            file_path TEXT NOT NULL,
            language TEXT NOT NULL,
            is_original INTEGER NOT NULL DEFAULT 0,
            source_subtitle_id INTEGER,
            status TEXT NOT NULL DEFAULT 'pending',
            error_message TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY (torrent_id) REFERENCES torrents(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_subtitles_torrent ON torrent_subtitles(torrent_id);

        CREATE TABLE IF NOT EXISTS automation_rules (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT DEFAULT '',
            trigger_type TEXT NOT NULL,
            trigger_config TEXT DEFAULT '{}',
            conditions TEXT DEFAULT '[]',
            actions TEXT DEFAULT '[]',
            enabled INTEGER NOT NULL DEFAULT 1,
            last_triggered_at INTEGER,
            trigger_count INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_automation_enabled ON automation_rules(enabled);
        CREATE INDEX IF NOT EXISTS idx_automation_trigger ON automation_rules(trigger_type);

        CREATE TABLE IF NOT EXISTS automation_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            rule_id TEXT NOT NULL,
            trigger_event TEXT NOT NULL,
            conditions_met INTEGER NOT NULL DEFAULT 1,
            actions_executed TEXT DEFAULT '[]',
            error_message TEXT,
            executed_at INTEGER NOT NULL,
            FOREIGN KEY (rule_id) REFERENCES automation_rules(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_auto_logs_rule ON automation_logs(rule_id);
    `);

    // Migration: add poster_url to watchlist
    const wlCols = db.prepare("PRAGMA table_info(watchlist)").all() as { name: string }[];
    if (!wlCols.some(c => c.name === 'poster_url')) {
        db.exec('ALTER TABLE watchlist ADD COLUMN poster_url TEXT');
    }

    // Migration: add poster_url to torrents
    const torrentCols = db.prepare("PRAGMA table_info(torrents)").all() as { name: string }[];
    if (!torrentCols.some(c => c.name === 'poster_url')) {
        db.exec('ALTER TABLE torrents ADD COLUMN poster_url TEXT');
    }

    // Migration: add prompt to automation_rules
    const autoRuleCols = getDb().prepare("PRAGMA table_info(automation_rules)").all() as { name: string }[];
    if (!autoRuleCols.some(c => c.name === 'prompt')) {
        getDb().exec("ALTER TABLE automation_rules ADD COLUMN prompt TEXT DEFAULT ''");
    }
}

export function closeTorrentDb(): void {
    closeDb();
}

// ── Torrent CRUD ──────────────────────────────────────────────────────────────

export function insertTorrent(record: {
    id: string;
    infoHash: string;
    name: string;
    magnetUri?: string;
    status: TorrentStatus;
    savePath: string;
    size?: number;
}): void {
    const now = Date.now();
    getDb().prepare(`
        INSERT INTO torrents (id, info_hash, name, magnet_uri, status, save_path, size, added_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(record.id, record.infoHash, record.name, record.magnetUri ?? null, record.status, record.savePath, record.size ?? 0, now, now);
}

export function updateTorrent(id: string, fields: Partial<{
    name: string;
    status: TorrentStatus;
    progress: number;
    downloadSpeed: number;
    uploadSpeed: number;
    downloaded: number;
    uploaded: number;
    size: number;
    numPeers: number;
    completedAt: number;
    errorMessage: string;
    tags: string[];
    posterUrl: string;
}>): void {
    const sets: string[] = [];
    const values: any[] = [];

    if (fields.name !== undefined) { sets.push('name = ?'); values.push(fields.name); }
    if (fields.status !== undefined) { sets.push('status = ?'); values.push(fields.status); }
    if (fields.progress !== undefined) { sets.push('progress = ?'); values.push(fields.progress); }
    if (fields.downloadSpeed !== undefined) { sets.push('download_speed = ?'); values.push(fields.downloadSpeed); }
    if (fields.uploadSpeed !== undefined) { sets.push('upload_speed = ?'); values.push(fields.uploadSpeed); }
    if (fields.downloaded !== undefined) { sets.push('downloaded = ?'); values.push(fields.downloaded); }
    if (fields.uploaded !== undefined) { sets.push('uploaded = ?'); values.push(fields.uploaded); }
    if (fields.size !== undefined) { sets.push('size = ?'); values.push(fields.size); }
    if (fields.numPeers !== undefined) { sets.push('num_peers = ?'); values.push(fields.numPeers); }
    if (fields.completedAt !== undefined) { sets.push('completed_at = ?'); values.push(fields.completedAt); }
    if (fields.errorMessage !== undefined) { sets.push('error_message = ?'); values.push(fields.errorMessage); }
    if (fields.tags !== undefined) { sets.push('tags = ?'); values.push(JSON.stringify(fields.tags)); }
    if (fields.posterUrl !== undefined) { sets.push('poster_url = ?'); values.push(fields.posterUrl); }

    if (sets.length === 0) return;
    sets.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);

    getDb().prepare(`UPDATE torrents SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function getTorrent(id: string): TorrentRecord | undefined {
    const row = getDb().prepare('SELECT * FROM torrents WHERE id = ?').get(id) as any;
    if (!row) return undefined;
    return rowToRecord(row);
}

export function getTorrentByHash(infoHash: string): TorrentRecord | undefined {
    const row = getDb().prepare('SELECT * FROM torrents WHERE info_hash = ?').get(infoHash) as any;
    if (!row) return undefined;
    return rowToRecord(row);
}

export function getTorrents(filter?: { status?: TorrentStatus; limit?: number }): TorrentRecord[] {
    let sql = 'SELECT * FROM torrents WHERE status != ?';
    const params: any[] = ['removed'];

    if (filter?.status) {
        sql += ' AND status = ?';
        params.push(filter.status);
    }
    sql += ' ORDER BY added_at DESC';
    if (filter?.limit) {
        sql += ' LIMIT ?';
        params.push(filter.limit);
    }

    const rows = getDb().prepare(sql).all(...params) as any[];
    return rows.map(rowToRecord);
}

export function getActiveTorrents(): TorrentRecord[] {
    const rows = getDb().prepare(
        "SELECT * FROM torrents WHERE status IN ('adding', 'downloading', 'seeding') ORDER BY added_at DESC"
    ).all() as any[];
    return rows.map(rowToRecord);
}

export function deleteTorrent(id: string): void {
    getDb().prepare('DELETE FROM torrents WHERE id = ?').run(id);
}

// ── Torrent Files ─────────────────────────────────────────────────────────────

export function insertTorrentFiles(torrentId: string, files: { name: string; path: string; size: number }[]): void {
    const stmt = getDb().prepare(
        'INSERT INTO torrent_files (torrent_id, name, path, size) VALUES (?, ?, ?, ?)'
    );
    const insertMany = getDb().transaction((items: typeof files) => {
        for (const f of items) {
            stmt.run(torrentId, f.name, f.path, f.size);
        }
    });
    insertMany(files);
}

export function getTorrentFiles(torrentId: string): TorrentFileRecord[] {
    const rows = getDb().prepare('SELECT * FROM torrent_files WHERE torrent_id = ? ORDER BY id').all(torrentId) as any[];
    return rows.map(r => ({
        name: r.name,
        path: r.path,
        size: r.size,
        progress: r.progress,
        selected: !!r.selected,
    }));
}

export function updateTorrentFileProgress(torrentId: string, filePath: string, progress: number): void {
    getDb().prepare('UPDATE torrent_files SET progress = ? WHERE torrent_id = ? AND path = ?')
        .run(progress, torrentId, filePath);
}

export function setFileSelection(torrentId: string, filePath: string, selected: boolean): void {
    getDb().prepare('UPDATE torrent_files SET selected = ? WHERE torrent_id = ? AND path = ?')
        .run(selected ? 1 : 0, torrentId, filePath);
}

export function updateTorrentInfoHash(id: string, infoHash: string): void {
    getDb().prepare('UPDATE torrents SET info_hash = ?, updated_at = ? WHERE id = ?').run(infoHash, Date.now(), id);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function rowToRecord(row: any): TorrentRecord {
    return {
        id: row.id,
        infoHash: row.info_hash,
        name: row.name,
        magnetUri: row.magnet_uri ?? undefined,
        status: row.status as TorrentStatus,
        progress: row.progress,
        downloadSpeed: row.download_speed,
        uploadSpeed: row.upload_speed,
        downloaded: row.downloaded,
        uploaded: row.uploaded,
        size: row.size,
        numPeers: row.num_peers,
        savePath: row.save_path,
        files: [],
        addedAt: row.added_at,
        completedAt: row.completed_at ?? undefined,
        errorMessage: row.error_message ?? undefined,
        tags: row.tags ? JSON.parse(row.tags) : undefined,
        posterUrl: row.poster_url ?? undefined,
    };
}
