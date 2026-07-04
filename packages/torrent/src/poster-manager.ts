// Fetches and stores TMDB posters for torrents and watchlist entries.
import { log, getSettings } from '@fonte/core';
import { getTorrent, getTorrents, updateTorrent } from './torrent-db';
import { getWatchlistEntries, updateWatchlistEntry } from './watchlist-db';
import { WatchlistRecord } from './types';
import { searchTmdb } from './tmdb-client';
import { parseTorrentName } from './subtitle-manager';

// Ids whose TMDB lookup completed with no match; backfill skips them so
// permanently unmatchable titles don't re-log every cycle. Thrown lookups
// are not recorded (they should retry). Clears on daemon restart.
const noMatchIds = new Set<string>();

interface PosterLookup {
    posterUrl?: string;
    noMatch?: boolean;
}

/** Search TMDB for a poster, swallowing failures into a warning + empty result. */
async function fetchPoster(title: string, mediaType: 'movie' | 'tv', apiKey: string, year?: number): Promise<PosterLookup> {
    try {
        const info = await searchTmdb({ title, year, mediaType, apiKey });
        if (!info?.posterUrl) {
            log('INFO', `Poster: no TMDB ${mediaType} match for "${title}"${year ? ` (${year})` : ''}`);
            return { noMatch: true };
        }
        return { posterUrl: info.posterUrl };
    } catch (err) {
        log('WARN', `Poster: TMDB lookup failed for "${title}": ${(err as Error).message}`);
        return {};
    }
}

/**
 * Look up a TMDB poster for a torrent from its release name and store it.
 * No-op when the key is unset, the name isn't known yet, or a poster already
 * exists — unless `force`, which re-runs the lookup (e.g. after a rename)
 * and overwrites only when a new poster is found.
 */
export async function fetchTorrentPoster(torrentId: string, apiKey?: string, opts: { force?: boolean } = {}): Promise<void> {
    const torrent = getTorrent(torrentId);
    if (!torrent || !torrent.name) return;
    if (torrent.posterUrl && !opts.force) return;
    if (opts.force) noMatchIds.delete(torrentId);

    const key = apiKey ?? getSettings().subtitles?.tmdb_api_key;
    if (!key) return;

    const parsed = parseTorrentName(torrent.name);
    if (!parsed.title) return;

    const lookup = await fetchPoster(parsed.title, parsed.isTv ? 'tv' : 'movie', key, parsed.year);
    if (lookup.posterUrl) {
        updateTorrent(torrentId, { posterUrl: lookup.posterUrl });
        log('INFO', `Poster: set for "${parsed.title}"`);
    } else if (lookup.noMatch) {
        noMatchIds.add(torrentId);
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

    const lookup = await fetchPoster(entry.title, entry.mediaType, key, entry.year);
    if (lookup.posterUrl) {
        updateWatchlistEntry(entry.id, { posterUrl: lookup.posterUrl });
        log('INFO', `Poster: set for watchlist "${entry.title}"`);
    } else if (lookup.noMatch) {
        noMatchIds.add(entry.id);
    }
}

/**
 * One-shot pass over existing torrents and watchlist entries that have no poster,
 * filling them from TMDB. Runs at startup and every watchlist cycle; safe to call
 * when no key is set. Ids that already came back with no TMDB match are skipped.
 */
export async function backfillPosters(): Promise<void> {
    const apiKey = getSettings().subtitles?.tmdb_api_key;
    if (!apiKey) return;

    const torrents = getTorrents().filter(t => t.name && !t.posterUrl && !noMatchIds.has(t.id));
    for (const t of torrents) {
        await fetchTorrentPoster(t.id, apiKey);
    }

    const entries = getWatchlistEntries().filter(e =>
        !e.posterUrl && (e.mediaType === 'movie' || e.mediaType === 'tv') && !noMatchIds.has(e.id));
    for (const entry of entries) {
        await fetchWatchlistPoster(entry, apiKey);
    }

    if (torrents.length || entries.length) {
        log('INFO', `Poster: backfill scanned ${torrents.length} torrents, ${entries.length} watchlist entries`);
    }
}
