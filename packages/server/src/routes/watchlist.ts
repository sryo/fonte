import { Hono } from 'hono';
import {
    insertWatchlistEntry, updateWatchlistEntry, getWatchlistEntry,
    getWatchlistEntries, deleteWatchlistEntry,
    getWatchlistResults, insertWatchlistResult, markResultSelected,
    getTorrentManager,
    runWatchlistCheck,
    aggregateSearch, filterByTitle, sortBySeedersThenSize, computeQualityMatch,
    searchReleases, searchTmdb,
} from '@fonte/torrent';
import type { WatchlistStatus, MediaType } from '@fonte/torrent';
import { log, genId, getSettings } from '@fonte/core';
import { ok, fail } from '../http';

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

// ── Smart search: try multiple query strategies across all sources ────────

async function multiSearch(title: string, year?: number, quality?: string, category?: number): Promise<any[]> {
    return searchReleases({ title, year, quality, category });
}

// ── POST /api/search — universal "find me this" endpoint ─────────────────
// Accepts: title, IMDB URL/ID, magnet URI, or info hash.
// Does the right thing automatically.

app.post('/api/search', async (c) => {
    try {
        const body = await c.req.json() as {
            query: string;
            mediaType?: MediaType;
            year?: number;
            quality?: string;
        };

        let query = (body.query || '').trim();
        if (!query) {
            return fail(c, 'query is required');
        }

        // If it's a magnet link, just add it directly
        if (query.startsWith('magnet:')) {
            const torrent = await getTorrentManager().addTorrent(query);
            return ok(c, { action: 'added', torrent });
        }

        // If it's an info hash (40 hex chars), add directly
        if (/^[a-fA-F0-9]{40}$/.test(query)) {
            const magnetUri = `magnet:?xt=urn:btih:${query}`;
            const torrent = await getTorrentManager().addTorrent(magnetUri);
            return ok(c, { action: 'added', torrent });
        }

        // If it's an IMDB URL or ID, extract the ID and resolve the title
        const imdbMatch = query.match(/tt\d{7,}/);
        if (imdbMatch) {
            const imdbId = imdbMatch[0];
            // Resolve title via TMDB
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
            // If no TMDB key, just strip the URL and use the ID as-is won't help much
            if (query === imdbMatch[0]) {
                return fail(c, 'Could not resolve IMDB ID. Set subtitles.tmdb_api_key in settings.');
            }
        }

        const quality = body.quality || '1080p';
        const mediaType = body.mediaType || 'movie';
        const category = CATEGORY_MAP[mediaType] || 2000;

        const results = await multiSearch(query, body.year, quality, category);

        return ok(c, {
            query,
            year: body.year,
            quality,
            resultCount: results.length,
            results: results.slice(0, 20),
        });
    } catch (err) {
        const msg = (err as Error).message;
        log('ERROR', `[search] Failed: ${msg}`);
        return fail(c, msg, 500);
    }
});

// ── POST /api/watchlist — add a watchlist entry ──────────────────────────

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
        const quality = body.quality || '1080p';
        const year = body.year;
        const seasonPattern = body.seasonPattern;

        const parts = [body.title];
        if (year) parts.push(String(year));
        if (quality) parts.push(quality);
        const searchQuery = parts.join(' ');

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

        // Try to get poster from TMDB
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
        return ok(c, { entry });
    } catch (err) {
        const msg = (err as Error).message;
        log('ERROR', `[watchlist] Add failed: ${msg}`);
        return fail(c, msg);
    }
});

// ── GET /api/watchlist ───────────────────────────────────────────────────

app.get('/api/watchlist', (c) => {
    const status = c.req.query('status') as WatchlistStatus | undefined;
    const entries = getWatchlistEntries(status ? { status } : undefined);
    return ok(c, { entries });
});

// ── GET /api/watchlist/:id ───────────────────────────────────────────────

app.get('/api/watchlist/:id', (c) => {
    const id = c.req.param('id');
    const entry = getWatchlistEntry(id);
    if (!entry) {
        return fail(c, 'Watchlist entry not found', 404);
    }
    const results = getWatchlistResults(id);
    return ok(c, { entry, results });
});

// ── PUT /api/watchlist/:id ───────────────────────────────────────────────

app.put('/api/watchlist/:id', async (c) => {
    const id = c.req.param('id');
    if (!getWatchlistEntry(id)) {
        return fail(c, 'Watchlist entry not found', 404);
    }
    try {
        const body = await c.req.json();
        updateWatchlistEntry(id, body);
        return ok(c, { entry: getWatchlistEntry(id) });
    } catch (err) {
        return fail(c, (err as Error).message);
    }
});

// ── DELETE /api/watchlist/:id ────────────────────────────────────────────

app.delete('/api/watchlist/:id', (c) => {
    const id = c.req.param('id');
    if (!getWatchlistEntry(id)) {
        return fail(c, 'Watchlist entry not found', 404);
    }
    deleteWatchlistEntry(id);
    return ok(c);
});

// ── POST /api/watchlist/:id/search — trigger search for this entry ───────

app.post('/api/watchlist/:id/search', async (c) => {
    const id = c.req.param('id');
    const entry = getWatchlistEntry(id);
    if (!entry) {
        return fail(c, 'Watchlist entry not found', 404);
    }

    try {
        const found = await multiSearch(entry.title, entry.year, entry.quality, entry.category);

        // Persist so the results have real ids (Add-as-Torrent needs them)
        // and survive the page's periodic re-fetch from the DB.
        for (const r of found.slice(0, 50)) {
            insertWatchlistResult({
                watchlistId: id,
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
        updateWatchlistEntry(id, { lastCheckedAt: Date.now() });

        const results = getWatchlistResults(id, 50);
        return ok(c, { resultCount: results.length, results });
    } catch (err) {
        const msg = (err as Error).message;
        log('ERROR', `[watchlist] Search failed for ${id}: ${msg}`);
        return fail(c, msg, 500);
    }
});

// ── POST /api/watchlist/:id/results/:rid/add — add result as torrent ─────

app.post('/api/watchlist/:id/results/:rid/add', async (c) => {
    const id = c.req.param('id');
    const rid = parseInt(c.req.param('rid'), 10);

    const entry = getWatchlistEntry(id);
    if (!entry) {
        return fail(c, 'Watchlist entry not found', 404);
    }

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
            status: 'fulfilled',
        });
        return ok(c, { torrent });
    } catch (err) {
        return fail(c, (err as Error).message);
    }
});

// ── POST /api/watchlist/check — trigger global check ─────────────────────

app.post('/api/watchlist/check', async (c) => {
    try {
        await runWatchlistCheck();
        return ok(c);
    } catch (err) {
        return fail(c, (err as Error).message, 500);
    }
});

export default app;
