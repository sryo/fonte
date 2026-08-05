import { Hono } from 'hono';
import {
    insertWatchlistEntry, updateWatchlistEntry, getWatchlistEntry,
    getWatchlistEntries, deleteWatchlistEntry,
    getWatchlistResults, insertWatchlistResult, markResultSelected, deleteUnselectedResults,
    getNewResultCounts, markWatchlistResultsViewed, isOngoingWatch,
    getTorrentManager,
    runWatchlistCheck,
    aggregateSearch, filterByTitle, sortBySeedersThenSize, computeQualityMatch,
    searchReleases, searchTmdb,
} from '@fonte/torrent';
import type { WatchlistStatus, MediaType } from '@fonte/torrent';
import { log, genId, getSettings } from '@fonte/core';
import { ok, fail, requireEntity } from '../http';

const requireEntry = requireEntity(getWatchlistEntry, 'Watchlist entry');

const CATEGORY_MAP: Record<string, number> = {
    movie: 2000,
    tv: 5000,
    music: 3000,
    game: 4000,
    book: 7000,
    app: 4000,
    other: 8000,
};

const app = new Hono();

async function multiSearch(title: string, year?: number, quality?: string, category?: number, season?: number): Promise<any[]> {
    return searchReleases({ title, year, quality, category, season });
}

// Year narrows every media type except TV: episodic releases are named by
// season/episode, not calendar year, so TV queries and filters skip it.
function buildSearchQuery(title: string, mediaType: MediaType, year: number | null | undefined, quality: string): string {
    const parts = [title];
    if (mediaType !== 'tv' && year) parts.push(String(year));
    if (quality) parts.push(quality);
    return parts.join(' ');
}

interface SearchableEntry {
    id: string;
    title: string;
    mediaType: MediaType;
    year?: number | null;
    quality: string;
    category?: number;
    seasonPattern?: string | null;
}

// Persist so the results have real ids (Add-as-Torrent needs them) and
// survive the page's periodic re-fetch from the DB.
async function searchAndPersist(entry: SearchableEntry): Promise<void> {
    const found = await searchReleases({
        title: entry.title,
        year: entry.mediaType !== 'tv' ? entry.year ?? undefined : undefined,
        quality: entry.quality,
        category: entry.category,
        seasonPattern: entry.seasonPattern ?? undefined,
    });
    for (const r of found.slice(0, 50)) {
        insertWatchlistResult({
            watchlistId: entry.id,
            title: r.title,
            magnetUri: r.magnetUri,
            seeders: r.seeders ?? 0,
            leechers: r.leechers ?? 0,
            size: r.size ?? 0,
            qualityMatch: computeQualityMatch(r.title, entry.quality),
            publishDate: r.publishDate,
            indexer: r.indexer,
        });
    }
    updateWatchlistEntry(entry.id, { lastCheckedAt: Date.now() });
}

// Accepts a title, IMDB URL/ID, magnet URI, or info hash and dispatches
// on the shape of the query.
app.post('/api/search', async (c) => {
    try {
        const body = await c.req.json() as {
            query: string;
            mediaType?: MediaType;
            year?: number;
            quality?: string;
            season?: number;
        };

        let query = (body.query || '').trim();
        if (!query) {
            return fail(c, 'query is required');
        }

        if (query.startsWith('magnet:')) {
            const torrent = await getTorrentManager().addTorrent(query);
            return ok(c, { action: 'added', torrent });
        }

        if (/^[a-fA-F0-9]{40}$/.test(query)) {
            const magnetUri = `magnet:?xt=urn:btih:${query}`;
            const torrent = await getTorrentManager().addTorrent(magnetUri);
            return ok(c, { action: 'added', torrent });
        }

        const imdbMatch = query.match(/tt\d{7,}/);
        if (imdbMatch) {
            const imdbId = imdbMatch[0];
            const settings = getSettings();
            const tmdbKey = settings.subtitles?.tmdb_api_key;
            if (tmdbKey) {
                try {
                    const res = await fetch(`https://api.themoviedb.org/3/find/${imdbId}?api_key=${tmdbKey}&external_source=imdb_id`, {
                        signal: AbortSignal.timeout(10000),
                    });
                    if (res.ok) {
                        const data = await res.json() as any;
                        const movie = data.movie_results?.[0] || data.tv_results?.[0];
                        if (movie) {
                            query = movie.title || movie.name || query;
                            if (!body.year && movie.release_date) {
                                body.year = parseInt(movie.release_date.slice(0, 4), 10);
                            }
                            if (!body.mediaType) {
                                body.mediaType = data.tv_results?.length ? 'tv' : 'movie';
                            }
                        }
                    }
                } catch {}
            }
            if (query === imdbMatch[0]) {
                return fail(c, 'Could not resolve IMDB ID. Set subtitles.tmdb_api_key in settings.');
            }
        }

        const quality = body.quality || '1080p';
        const mediaType = body.mediaType || (body.season != null ? 'tv' : 'movie');
        const category = CATEGORY_MAP[mediaType] || 2000;

        const results = await multiSearch(query, body.year, quality, category, body.season);

        return ok(c, {
            query,
            year: body.year,
            quality,
            season: body.season,
            resultCount: results.length,
            results: results.slice(0, 20),
        });
    } catch (err) {
        const msg = (err as Error).message;
        log('ERROR', `[search] Failed: ${msg}`);
        return fail(c, msg, 500);
    }
});

app.post('/api/watchlist', async (c) => {
    try {
        const body = await c.req.json() as {
            title: string;
            mediaType?: MediaType;
            year?: number;
            quality?: string;
            seasonPattern?: string;
        };

        if (!body.title) {
            return fail(c, 'title is required');
        }

        const mediaType: MediaType = body.mediaType || 'movie';
        // Quality is a per-type vocabulary (1080p, FLAC, EPUB…); empty means
        // any. Only default when the field was absent entirely.
        const DEFAULT_QUALITY: Record<string, string> = { movie: '1080p', tv: '1080p', music: 'FLAC' };
        const quality = body.quality !== undefined ? body.quality : (DEFAULT_QUALITY[mediaType] ?? '');
        const year = body.year;
        const seasonPattern = body.seasonPattern;

        const searchQuery = buildSearchQuery(body.title, mediaType, year, quality);

        const category = CATEGORY_MAP[mediaType] || 2000;

        const id = genId('wl');
        insertWatchlistEntry({
            id,
            title: body.title,
            mediaType,
            year,
            seasonPattern,
            quality,
            searchQuery,
            category,
        });

        const settings = getSettings();
        const tmdbKey = settings.subtitles?.tmdb_api_key;
        if (tmdbKey && (mediaType === 'movie' || mediaType === 'tv')) {
            try {
                const tmdbInfo = await searchTmdb({
                    title: body.title,
                    year: body.year,
                    mediaType: mediaType as 'movie' | 'tv',
                    apiKey: tmdbKey,
                });
                if (tmdbInfo?.posterUrl) {
                    updateWatchlistEntry(id, { posterUrl: tmdbInfo.posterUrl });
                }
            } catch {}
        }

        const entry = getWatchlistEntry(id);
        if (entry) {
            // First search fires immediately; results surface on the next poll
            // (purple ring + "new" chip) without holding up the add response.
            searchAndPersist(entry).catch(err =>
                log('ERROR', `[watchlist] Initial search failed for ${id}: ${(err as Error).message}`));
        }
        return ok(c, { entry });
    } catch (err) {
        const msg = (err as Error).message;
        log('ERROR', `[watchlist] Add failed: ${msg}`);
        return fail(c, msg);
    }
});

app.get('/api/watchlist', (c) => {
    const status = c.req.query('status') as WatchlistStatus | undefined;
    const newCounts = getNewResultCounts();
    const entries = getWatchlistEntries(status ? { status } : undefined)
        .map(e => ({ ...e, newResultsCount: newCounts[e.id] ?? 0 }));
    return ok(c, { entries });
});

app.get('/api/watchlist/:id', requireEntry, (c) => {
    const id = c.req.param('id');
    const results = getWatchlistResults(id);
    return ok(c, { entry: c.get('entity'), results });
});

app.put('/api/watchlist/:id', requireEntry, async (c) => {
    const id = c.req.param('id');
    const before = c.get('entity');
    try {
        const body = await c.req.json();
        updateWatchlistEntry(id, body);

        const updated = getWatchlistEntry(id)!;
        const searchQuery = buildSearchQuery(updated.title, updated.mediaType, updated.year, updated.quality);
        if (searchQuery !== updated.searchQuery) {
            updateWatchlistEntry(id, { searchQuery });
        }

        // A changed query or season pattern invalidates prior finds — clear
        // the unselected ones so stale titles don't linger as "new".
        if (searchQuery !== before.searchQuery || (updated.seasonPattern ?? null) !== (before.seasonPattern ?? null)) {
            deleteUnselectedResults(id);
        }
        if (updated.status === 'watching') {
            searchAndPersist(updated).catch(err =>
                log('ERROR', `[watchlist] Post-edit search failed for ${id}: ${(err as Error).message}`));
        }
        return ok(c, { entry: getWatchlistEntry(id) });
    } catch (err) {
        return fail(c, (err as Error).message);
    }
});

app.delete('/api/watchlist/:id', requireEntry, (c) => {
    deleteWatchlistEntry(c.req.param('id'));
    return ok(c);
});

// Run the full periodic check on demand (all watching entries, auto-add included).
app.post('/api/watchlist/check', async (c) => {
    try {
        await runWatchlistCheck();
        return ok(c);
    } catch (err) {
        return fail(c, (err as Error).message, 500);
    }
});

app.post('/api/watchlist/:id/search', requireEntry, async (c) => {
    const id = c.req.param('id');
    const entry = c.get('entity');

    try {
        // Searching a fulfilled entry is an explicit "find me more": it
        // rejoins the watching flow (periodic checks and auto-add included).
        if (entry.status === 'fulfilled') {
            updateWatchlistEntry(id, { status: 'watching' });
        }
        await searchAndPersist(entry);

        const results = getWatchlistResults(id, 50);
        return ok(c, { resultCount: results.length, results });
    } catch (err) {
        const msg = (err as Error).message;
        log('ERROR', `[watchlist] Search failed for ${id}: ${msg}`);
        return fail(c, msg, 500);
    }
});

app.post('/api/watchlist/:id/results/:rid/add', requireEntry, async (c) => {
    const id = c.req.param('id');
    const rid = parseInt(c.req.param('rid'), 10);
    const entry = c.get('entity');

    const results = getWatchlistResults(id);
    const result = results.find(r => r.id === rid);
    if (!result) {
        return fail(c, 'Result not found', 404);
    }

    try {
        const torrent = await getTorrentManager().addTorrent(result.magnetUri);
        markResultSelected(rid);
        updateWatchlistEntry(id, {
            lastMatchAt: Date.now(),
            matchedTorrentId: torrent.id,
            // Same rule as the runner's auto-add: grabbing episodes from an
            // ongoing series keeps it watching; bounded targets fulfill.
            status: isOngoingWatch(entry) ? 'watching' : 'fulfilled',
        });
        return ok(c, { torrent });
    } catch (err) {
        return fail(c, (err as Error).message);
    }
});

app.post('/api/watchlist/:id/results/viewed', requireEntry, (c) => {
    markWatchlistResultsViewed(c.req.param('id'));
    return ok(c);
});

app.post('/api/watchlist/check', async (c) => {
    try {
        await runWatchlistCheck();
        return ok(c);
    } catch (err) {
        return fail(c, (err as Error).message, 500);
    }
});

export default app;
