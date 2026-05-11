import { getDb } from './db-connection';
import { SubtitleRecord, SubtitleStatus } from './types';

// ── Subtitle CRUD ────────────────────────────────────────────────────────────

export function insertSubtitle(record: {
    torrentId: string;
    filePath: string;
    language: string;
    isOriginal: boolean;
    sourceSubtitleId?: number;
}): number {
    const now = Date.now();
    const result = getDb().prepare(`
        INSERT INTO torrent_subtitles (torrent_id, file_path, language, is_original, source_subtitle_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
        record.torrentId,
        record.filePath,
        record.language,
        record.isOriginal ? 1 : 0,
        record.sourceSubtitleId ?? null,
        now,
        now,
    );
    return Number(result.lastInsertRowid);
}

export function updateSubtitle(id: number, fields: Partial<{
    status: SubtitleStatus;
    filePath: string;
    errorMessage: string;
}>): void {
    const sets: string[] = [];
    const values: any[] = [];

    if (fields.status !== undefined) { sets.push('status = ?'); values.push(fields.status); }
    if (fields.filePath !== undefined) { sets.push('file_path = ?'); values.push(fields.filePath); }
    if (fields.errorMessage !== undefined) { sets.push('error_message = ?'); values.push(fields.errorMessage); }

    if (sets.length === 0) return;
    sets.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);

    getDb().prepare(`UPDATE torrent_subtitles SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function getSubtitle(id: number): SubtitleRecord | undefined {
    const row = getDb().prepare('SELECT * FROM torrent_subtitles WHERE id = ?').get(id) as any;
    if (!row) return undefined;
    return rowToSubtitleRecord(row);
}

export function getSubtitlesByTorrent(torrentId: string): SubtitleRecord[] {
    const rows = getDb().prepare('SELECT * FROM torrent_subtitles WHERE torrent_id = ? ORDER BY created_at DESC').all(torrentId) as any[];
    return rows.map(rowToSubtitleRecord);
}

export function deleteSubtitle(id: number): void {
    getDb().prepare('DELETE FROM torrent_subtitles WHERE id = ?').run(id);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function rowToSubtitleRecord(row: any): SubtitleRecord {
    return {
        id: row.id,
        torrentId: row.torrent_id,
        filePath: row.file_path,
        language: row.language,
        isOriginal: !!row.is_original,
        sourceSubtitleId: row.source_subtitle_id ?? undefined,
        status: row.status as SubtitleStatus,
        errorMessage: row.error_message ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
