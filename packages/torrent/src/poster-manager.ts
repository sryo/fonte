// Fetches and stores TMDB posters for torrents and watchlist entries.
import { log, getSettings } from '@fonte/core';
import { getTorrent, getTorrents, updateTorrent } from './torrent-db';
import { getWatchlistEntries, updateWatchlistEntry } from './watchlist-db';
import { WatchlistRecord } from './types';
import { searchTmdb } from './tmdb-client';
import { parseTorrentName } from './subtitle-manager';

/** Search TMDB for a poster, swallowing failures into a warning + undefined. */
async function fetchPoster(title: string, mediaType: 'movie' | 'tv', apiKey: string, year?: number): Promise<string | undefined> {
    try {
        const info = await searchTmdb({ title, year, mediaType, apiKey });
        if (!info?.posterUrl) {
            log('INFO', `Poster: no TMDB ${mediaType} match for "${title}"${year ? ` (${year})` : ''}`);
            return undefined;
        }
        return info.posterUrl;
    } catch (err) {
        log('WARN', `Poster: TMDB lookup failed for "${title}": ${(err as Error).message}`);
        return undefined;
    }
}

/**
 * Look up a TMDB poster for a torrent from its release name and store it.
 * No-op when the key is unset, the name isn't known yet, or a poster already exists.
 */
export async function fetchTorrentPoster(torrentId: string, apiKey?: string): Promise<void> {
    const torrent = getTorrent(torrentId);
    if (!torrent || !torrent.name || torrent.posterUrl) return;

    const key = apiKey ?? getSettings().subtitles?.tmdb_api_key;
    if (!key) return;

    const parsed = parseTorrentName(torrent.name);
    if (!parsed.title) return;

    const posterUrl = await fetchPoster(parsed.title, parsed.isTv ? 'tv' : 'movie', key, parsed.year);
    if (posterUrl) {
        updateTorrent(torrentId, { posterUrl });
        log('INFO', `Poster: set for "${parsed.title}"`);
    }
}

/**
 * Look up a TMDB poster for a watchlist entry and store it.
 * No-op when the key is unset, a poster already exists, or the type has no posters.
 */
export async function fetchWatchlistPoster(entry: WatchlistRecord, apiKey?: string): Promise<void> {
    if (entry.posterUrl || (entry.mediaType !== 'movie' && entry.mediaType !== 'tv')) return;

    const key = apiKey ?? getSettings().subtitles?.tmdb_api_key;
    if (!key) return;

    const posterUrl = await fetchPoster(entry.title, entry.mediaType, key, entry.year);
    if (posterUrl) {
        updateWatchlistEntry(entry.id, { posterUrl });
        log('INFO', `Poster: set for watchlist "${entry.title}"`);
    }
}

/**
 * One-shot pass over existing torrents and watchlist entries that have no poster,
 * filling them from TMDB. Runs at startup and is safe to call when no key is set.
 */
export async function backfillPosters(): Promise<void> {
    const apiKey = getSettings().subtitles?.tmdb_api_key;
    if (!apiKey) return;

    const torrents = getTorrents().filter(t => t.name && !t.posterUrl);
    for (const t of torrents) {
        await fetchTorrentPoster(t.id, apiKey);
    }

    const entries = getWatchlistEntries().filter(e => !e.posterUrl && (e.mediaType === 'movie' || e.mediaType === 'tv'));
    for (const entry of entries) {
        await fetchWatchlistPoster(entry, apiKey);
    }

    if (torrents.length || entries.length) {
        log('INFO', `Poster: backfill scanned ${torrents.length} torrents, ${entries.length} watchlist entries`);
    }
}
