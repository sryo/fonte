import { getDb } from './db-connection';
import { WatchlistRecord, WatchlistResultRecord, WatchlistStatus, MediaType } from './types';
import { extractInfoHash } from './search-aggregator';

// ── Watchlist CRUD ───────────────────────────────────────────────────────────

/**
 * The year a search may carry. Episodic TV is named by season and episode, and
 * Other covers releases that follow no naming convention at all. For both, a
 * year reaches filterByTitle and drops every result whose title omits it.
 */
export function searchYear(mediaType: MediaType, year?: number | null): number | undefined {
    if (mediaType === 'tv' || mediaType === 'other') return undefined;
    return year ?? undefined;
}

/**
 * An ongoing watch keeps matching new releases (episodes, tracks) after a
 * grab; a bounded one (movie, or a specific season pattern) is fulfilled by
 * its first match.
 */
export function isOngoingWatch(entry: Pick<WatchlistRecord, 'mediaType' | 'seasonPattern'>): boolean {
    return (entry.mediaType === 'tv' || entry.mediaType === 'music') && !entry.seasonPattern;
}

export function insertWatchlistEntry(record: {
    id: string;
    title: string;
    mediaType: MediaType;
    year?: number;
    seasonPattern?: string;
    quality: string;
    searchQuery: string;
    category: number;
    posterUrl?: string;
}): void {
    const now = Date.now();
    getDb().prepare(`
        INSERT INTO watchlist (id, title, media_type, year, season_pattern, quality, search_query, category, poster_url, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        record.id,
        record.title,
        record.mediaType,
        record.year ?? null,
        record.seasonPattern ?? null,
        record.quality,
        record.searchQuery,
        record.category,
        record.posterUrl ?? null,
        now,
        now,
    );
}

export function updateWatchlistEntry(id: string, fields: Partial<{
    title: string;
    mediaType: MediaType;
    year: number | null;
    seasonPattern: string | null;
    quality: string;
    searchQuery: string;
    category: number;
    enabled: boolean;
    status: WatchlistStatus;
    lastCheckedAt: number;
    lastMatchAt: number;
    matchedTorrentId: string;
    posterUrl: string | null;
}>): void {
    const sets: string[] = [];
    const values: any[] = [];

    if (fields.title !== undefined) { sets.push('title = ?'); values.push(fields.title); }
    if (fields.mediaType !== undefined) { sets.push('media_type = ?'); values.push(fields.mediaType); }
    if (fields.year !== undefined) { sets.push('year = ?'); values.push(fields.year); }
    if (fields.seasonPattern !== undefined) { sets.push('season_pattern = ?'); values.push(fields.seasonPattern); }
    if (fields.quality !== undefined) { sets.push('quality = ?'); values.push(fields.quality); }
    if (fields.searchQuery !== undefined) { sets.push('search_query = ?'); values.push(fields.searchQuery); }
    if (fields.category !== undefined) { sets.push('category = ?'); values.push(fields.category); }
    if (fields.enabled !== undefined) { sets.push('enabled = ?'); values.push(fields.enabled ? 1 : 0); }
    if (fields.status !== undefined) { sets.push('status = ?'); values.push(fields.status); }
    if (fields.lastCheckedAt !== undefined) { sets.push('last_checked_at = ?'); values.push(fields.lastCheckedAt); }
    if (fields.lastMatchAt !== undefined) { sets.push('last_match_at = ?'); values.push(fields.lastMatchAt); }
    if (fields.matchedTorrentId !== undefined) { sets.push('matched_torrent_id = ?'); values.push(fields.matchedTorrentId); }
    if (fields.posterUrl !== undefined) { sets.push('poster_url = ?'); values.push(fields.posterUrl); }

    if (sets.length === 0) return;
    sets.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);

    getDb().prepare(`UPDATE watchlist SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function getWatchlistEntry(id: string): WatchlistRecord | undefined {
    const row = getDb().prepare('SELECT * FROM watchlist WHERE id = ?').get(id) as any;
    if (!row) return undefined;
    return rowToWatchlistRecord(row);
}

export function getWatchlistEntries(filter?: { status?: WatchlistStatus; enabled?: boolean }): WatchlistRecord[] {
    let sql = 'SELECT * FROM watchlist';
    const conditions: string[] = [];
    const params: any[] = [];

    if (filter?.status) {
        conditions.push('status = ?');
        params.push(filter.status);
    }
    if (filter?.enabled !== undefined) {
        conditions.push('enabled = ?');
        params.push(filter.enabled ? 1 : 0);
    }

    if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY created_at DESC';

    const rows = getDb().prepare(sql).all(...params) as any[];
    return rows.map(rowToWatchlistRecord);
}

export function deleteWatchlistEntry(id: string): void {
    getDb().prepare('DELETE FROM watchlist WHERE id = ?').run(id);
}

// ── Watchlist Results ────────────────────────────────────────────────────────

/** Insert a search result, or refresh the existing row for the same magnet so repeated checks don't grow the table unboundedly. */
export function insertWatchlistResult(result: {
    watchlistId: string;
    title: string;
    magnetUri: string;
    seeders: number;
    leechers: number;
    size: number;
    qualityMatch: number;
    publishDate?: number;
    indexer?: string;
}): { id: number; created: boolean } {
    const now = Date.now();
    const infoHash = extractInfoHash(result.magnetUri) ?? null;
    const existing = getDb().prepare(
        'SELECT id FROM watchlist_results WHERE watchlist_id = ? AND magnet_uri = ?'
    ).get(result.watchlistId, result.magnetUri) as { id: number } | undefined;

    if (existing) {
        getDb().prepare(`
            UPDATE watchlist_results
            SET title = ?, seeders = ?, leechers = ?, size = ?, quality_match = ?, publish_date = ?, indexer = ?, info_hash = ?, found_at = ?
            WHERE id = ?
        `).run(
            result.title,
            result.seeders,
            result.leechers,
            result.size,
            result.qualityMatch,
            result.publishDate ?? null,
            result.indexer ?? null,
            infoHash,
            now,
            existing.id,
        );
        return { id: existing.id, created: false };
    }

    const info = getDb().prepare(`
        INSERT INTO watchlist_results (watchlist_id, title, magnet_uri, seeders, leechers, size, quality_match, publish_date, indexer, info_hash, found_at, first_found_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        result.watchlistId,
        result.title,
        result.magnetUri,
        result.seeders,
        result.leechers,
        result.size,
        result.qualityMatch,
        result.publishDate ?? null,
        result.indexer ?? null,
        infoHash,
        now,
        now,
    );
    return { id: Number(info.lastInsertRowid), created: true };
}

export function getWatchlistResultByMagnet(watchlistId: string, magnetUri: string): WatchlistResultRecord | undefined {
    const row = getDb().prepare(
        'SELECT * FROM watchlist_results WHERE watchlist_id = ? AND magnet_uri = ?'
    ).get(watchlistId, magnetUri) as any;
    return row ? rowToResultRecord(row) : undefined;
}

export function getWatchlistResults(watchlistId: string, limit?: number): WatchlistResultRecord[] {
    let sql = 'SELECT * FROM watchlist_results WHERE watchlist_id = ? ORDER BY quality_match DESC, seeders DESC';
    const params: any[] = [watchlistId];

    if (limit) {
        sql += ' LIMIT ?';
        params.push(limit);
    }

    const rows = getDb().prepare(sql).all(...params) as any[];
    return rows.map(rowToResultRecord);
}

export function markResultSelected(resultId: number): void {
    getDb().prepare('UPDATE watchlist_results SET was_selected = 1 WHERE id = ?').run(resultId);
}

export function setResultFeedback(resultId: number, feedback: -1 | 0 | 1): void {
    getDb().prepare('UPDATE watchlist_results SET feedback = ? WHERE id = ?').run(feedback, resultId);
}

/** Releases the auto-add gate must skip: downvoted or blocked by a removal. */
export function getBlockedResultKeys(watchlistId: string): { infoHashes: Set<string>; magnetUris: Set<string> } {
    const rows = getDb().prepare(
        'SELECT info_hash, magnet_uri FROM watchlist_results WHERE watchlist_id = ? AND (feedback = -1 OR auto_blocked = 1)'
    ).all(watchlistId) as { info_hash: string | null; magnet_uri: string }[];
    return {
        infoHashes: new Set(rows.map(r => r.info_hash).filter((h): h is string => !!h)),
        magnetUris: new Set(rows.map(r => r.magnet_uri)),
    };
}

export function getFeedbackTitles(watchlistId: string): { title: string; feedback: number }[] {
    return getDb().prepare(
        'SELECT title, feedback FROM watchlist_results WHERE watchlist_id = ? AND feedback != 0'
    ).all(watchlistId) as { title: string; feedback: number }[];
}

export function blockResultsByInfoHash(infoHash: string): number {
    return getDb().prepare(
        'UPDATE watchlist_results SET auto_blocked = 1 WHERE info_hash = lower(?)'
    ).run(infoHash).changes;
}

/** A manual add contradicts a downvote but not an upvote. */
export function clearResultBlock(resultId: number): void {
    getDb().prepare(
        'UPDATE watchlist_results SET auto_blocked = 0, feedback = CASE WHEN feedback = -1 THEN 0 ELSE feedback END WHERE id = ?'
    ).run(resultId);
}

/** Per-entry count of unselected results first found after the entry was last viewed. */
export function getNewResultCounts(): Record<string, number> {
    const rows = getDb().prepare(`
        SELECT w.id AS id, COUNT(r.id) AS n
        FROM watchlist w
        JOIN watchlist_results r
          ON r.watchlist_id = w.id
         AND r.was_selected = 0
         AND r.feedback != -1
         AND r.auto_blocked = 0
         AND r.first_found_at > COALESCE(w.results_viewed_at, 0)
        GROUP BY w.id
    `).all() as { id: string; n: number }[];
    const counts: Record<string, number> = {};
    for (const row of rows) counts[row.id] = row.n;
    return counts;
}

export function markWatchlistResultsViewed(id: string): void {
    getDb().prepare('UPDATE watchlist SET results_viewed_at = ? WHERE id = ?').run(Date.now(), id);
}

/** Drop prior finds after a query/pattern edit; selected and voted/blocked ones stay as history. */
export function deleteUnselectedResults(watchlistId: string): number {
    return getDb().prepare(
        'DELETE FROM watchlist_results WHERE watchlist_id = ? AND was_selected = 0 AND feedback = 0 AND auto_blocked = 0'
    ).run(watchlistId).changes;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function rowToWatchlistRecord(row: any): WatchlistRecord {
    return {
        id: row.id,
        title: row.title,
        mediaType: row.media_type as MediaType,
        year: row.year ?? undefined,
        seasonPattern: row.season_pattern ?? undefined,
        quality: row.quality,
        searchQuery: row.search_query,
        category: row.category,
        enabled: !!row.enabled,
        status: row.status as WatchlistStatus,
        lastCheckedAt: row.last_checked_at ?? undefined,
        lastMatchAt: row.last_match_at ?? undefined,
        matchedTorrentId: row.matched_torrent_id ?? undefined,
        posterUrl: row.poster_url ?? undefined,
        resultsViewedAt: row.results_viewed_at ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function rowToResultRecord(row: any): WatchlistResultRecord {
    return {
        id: row.id,
        watchlistId: row.watchlist_id,
        title: row.title,
        magnetUri: row.magnet_uri,
        seeders: row.seeders,
        leechers: row.leechers,
        size: row.size,
        qualityMatch: row.quality_match,
        publishDate: row.publish_date ?? undefined,
        indexer: row.indexer ?? undefined,
        wasSelected: !!row.was_selected,
        feedback: (row.feedback ?? 0) as -1 | 0 | 1,
        autoBlocked: !!row.auto_blocked,
        foundAt: row.found_at,
    };
}
