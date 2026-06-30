import { log, getSettings } from '@fonte/core';
import { getTorrent, getTorrents, updateTorrent } from './torrent-db';
import { getWatchlistEntries, updateWatchlistEntry } from './watchlist-db';
import { searchTmdb } from './tmdb-client';
import { parseTorrentName } from './subtitle-manager';

/**
 * Look up a TMDB poster for a torrent from its release name and store it.
 * No-op when the key is unset, the name isn't known yet, or a poster already exists.
 */
export async function fetchTorrentPoster(torrentId: string): Promise<void> {
    const torrent = getTorrent(torrentId);
    if (!torrent || !torrent.name || torrent.posterUrl) return;

    const apiKey = getSettings().subtitles?.tmdb_api_key;
    if (!apiKey) return;

    const parsed = parseTorrentName(torrent.name);
    if (!parsed.title) return;

    try {
        const info = await searchTmdb({
            title: parsed.title,
            year: parsed.year,
            mediaType: parsed.isTv ? 'tv' : 'movie',
            apiKey,
        });
        if (info?.posterUrl) {
            updateTorrent(torrentId, { posterUrl: info.posterUrl });
            log('INFO', `Poster: set for "${parsed.title}"`);
        }
    } catch (err) {
        log('WARN', `Poster: TMDB lookup failed for "${parsed.title}": ${(err as Error).message}`);
    }
}

/**
 * One-shot pass over existing torrents and watchlist entries that have no poster,
 * filling them from TMDB. Runs at startup and is safe to call when no key is set.
 */
export async function backfillPosters(): Promise<void> {
    if (!getSettings().subtitles?.tmdb_api_key) return;

    const torrents = getTorrents().filter(t => t.name && !t.posterUrl);
    for (const t of torrents) {
        await fetchTorrentPoster(t.id);
    }

    const entries = getWatchlistEntries().filter(e => !e.posterUrl && (e.mediaType === 'movie' || e.mediaType === 'tv'));
    const apiKey = getSettings().subtitles?.tmdb_api_key!;
    for (const entry of entries) {
        try {
            const info = await searchTmdb({
                title: entry.title,
                year: entry.year,
                mediaType: entry.mediaType as 'movie' | 'tv',
                apiKey,
            });
            if (info?.posterUrl) {
                updateWatchlistEntry(entry.id, { posterUrl: info.posterUrl });
                log('INFO', `Poster: set for watchlist "${entry.title}"`);
            }
        } catch (err) {
            log('WARN', `Poster: watchlist lookup failed for "${entry.title}": ${(err as Error).message}`);
        }
    }

    if (torrents.length || entries.length) {
        log('INFO', `Poster: backfill scanned ${torrents.length} torrents, ${entries.length} watchlist entries`);
    }
}
