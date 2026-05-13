import { Hono } from 'hono';
import {
    insertWatchlistEntry, updateWatchlistEntry, getWatchlistEntry,
    getWatchlistEntries, deleteWatchlistEntry,
    getWatchlistResults, markResultSelected,
    getTorrentManager,
    runWatchlistCheck, searchJackett, searchBt4g,
    searchTmdb,
} from '@aitorrent/torrent';
import type { WatchlistStatus, MediaType } from '@aitorrent/torrent';
import { log, genId, getSettings } from '@aitorrent/core';

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
    const settings = getSettings();
    const jackettUrl = settings.watchlist?.jackett_url;
    const apiKey = settings.watchlist?.jackett_api_key;

    // Build multiple query variations to maximize coverage
    const queries = new Set<string>();
    queries.add(`${title} ${year || ''} ${quality || ''}`.trim());
    queries.add(`${title} ${year || ''}`.trim());
    queries.add(title);

    const allResults: any[] = [];
    const seenHashes = new Set<string>();

    for (const query of queries) {
        // Search Jackett
        if (jackettUrl && apiKey) {
            try {
                const results = await searchJackett({
                    query,
                    categories: category ? [category] : [],
                    jackettUrl,
                    apiKey,
                });
                for (const r of results) {
                    const hash = extractHash(r.magnetUri);
                    if (hash && seenHashes.has(hash)) continue;
                    if (hash) seenHashes.add(hash);
                    allResults.push({ ...r, source: r.indexer || 'jackett' });
                }
            } catch (err) {
                log('WARN', `[search] Jackett failed for "${query}": ${(err as Error).message}`);
            }
        }

        // Search bt4g (DHT)
        try {
            const bt4gResults = await searchBt4g(query);
            for (const r of bt4gResults) {
                if (!r.magnetUri) continue;
                if (r.category?.toLowerCase() === 'doc' || r.category?.toLowerCase() === 'audio') continue;
                const hash = extractHash(r.magnetUri) || r.infoHash;
                if (hash && seenHashes.has(hash)) continue;
                if (hash) seenHashes.add(hash);
                allResults.push({
                    title: r.title,
                    magnetUri: r.magnetUri,
                    seeders: 0,
                    leechers: 0,
                    size: parseSizeStr(r.size),
                    sizeStr: r.size,
                    publishDate: r.publishDate,
                    source: 'bt4g-dht',
                });
            }
        } catch (err) {
            log('WARN', `[search] bt4g failed for "${query}": ${(err as Error).message}`);
        }
    }

    // Filter: title words + year must match
    const titleWords = title.toLowerCase().split(/\s+/);
    const filtered = allResults.filter(r => {
        const rt = r.title.toLowerCase();
        if (!titleWords.every((w: string) => rt.includes(w))) return false;
        if (year && !rt.includes(String(year))) return false;
        return true;
    });

    // Sort: seeders desc, then size desc (bigger = better quality usually)
    filtered.sort((a: any, b: any) => (b.seeders || 0) - (a.seeders || 0) || (b.size || 0) - (a.size || 0));

    return filtered;
}

function extractHash(magnetUri: string): string | undefined {
    const match = magnetUri.match(/xt=urn:btih:([a-fA-F0-9]{40})/i);
    return match ? match[1].toLowerCase() : undefined;
}

function parseSizeStr(size: string): number {
    if (!size) return 0;
    const match = size.match(/([\d.]+)\s*(GB|MB|KB|TB)/i);
    if (!match) return 0;
    const value = parseFloat(match[1]);
    const unit = match[2].toUpperCase();
    const m: Record<string, number> = { KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };
    return Math.round(value * (m[unit] || 0));
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
            return c.json({ ok: false, error: 'query is required' }, 400);
        }

        // If it's a magnet link, just add it directly
        if (query.startsWith('magnet:')) {
            const torrent = await getTorrentManager().addTorrent(query);
            return c.json({ ok: true, action: 'added', torrent });
        }

        // If it's an info hash (40 hex chars), add directly
        if (/^[a-fA-F0-9]{40}$/.test(query)) {
            const magnetUri = `magnet:?xt=urn:btih:${query}`;
            const torrent = await getTorrentManager().addTorrent(magnetUri);
            return c.json({ ok: true, action: 'added', torrent });
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
                return c.json({ ok: false, error: 'Could not resolve IMDB ID. Set subtitles.tmdb_api_key in settings.' }, 400);
            }
        }

        const quality = body.quality || '1080p';
        const mediaType = body.mediaType || 'movie';
        const category = CATEGORY_MAP[mediaType] || 2000;

        const results = await multiSearch(query, body.year, quality, category);

        return c.json({
            ok: true,
            query,
            year: body.year,
            quality,
            resultCount: results.length,
            results: results.slice(0, 20),
        });
    } catch (err) {
        const msg = (err as Error).message;
        log('ERROR', `[search] Failed: ${msg}`);
        return c.json({ ok: false, error: msg }, 500);
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
            return c.json({ ok: false, error: 'title is required' }, 400);
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
        return c.json({ ok: true, entry });
    } catch (err) {
        const msg = (err as Error).message;
        log('ERROR', `[watchlist] Add failed: ${msg}`);
        return c.json({ ok: false, error: msg }, 400);
    }
});

// ── GET /api/watchlist ───────────────────────────────────────────────────

app.get('/api/watchlist', (c) => {
    const status = c.req.query('status') as WatchlistStatus | undefined;
    const entries = getWatchlistEntries(status ? { status } : undefined);
    return c.json({ ok: true, entries });
});

// ── GET /api/watchlist/:id ───────────────────────────────────────────────

app.get('/api/watchlist/:id', (c) => {
    const id = c.req.param('id');
    const entry = getWatchlistEntry(id);
    if (!entry) {
        return c.json({ ok: false, error: 'Watchlist entry not found' }, 404);
    }
    const results = getWatchlistResults(id);
    return c.json({ ok: true, entry, results });
});

// ── PUT /api/watchlist/:id ───────────────────────────────────────────────

app.put('/api/watchlist/:id', async (c) => {
    const id = c.req.param('id');
    if (!getWatchlistEntry(id)) {
        return c.json({ ok: false, error: 'Watchlist entry not found' }, 404);
    }
    try {
        const body = await c.req.json();
        updateWatchlistEntry(id, body);
        return c.json({ ok: true, entry: getWatchlistEntry(id) });
    } catch (err) {
        return c.json({ ok: false, error: (err as Error).message }, 400);
    }
});

// ── DELETE /api/watchlist/:id ────────────────────────────────────────────

app.delete('/api/watchlist/:id', (c) => {
    const id = c.req.param('id');
    if (!getWatchlistEntry(id)) {
        return c.json({ ok: false, error: 'Watchlist entry not found' }, 404);
    }
    deleteWatchlistEntry(id);
    return c.json({ ok: true });
});

// ── POST /api/watchlist/:id/search — trigger search for this entry ───────

app.post('/api/watchlist/:id/search', async (c) => {
    const id = c.req.param('id');
    const entry = getWatchlistEntry(id);
    if (!entry) {
        return c.json({ ok: false, error: 'Watchlist entry not found' }, 404);
    }

    try {
        const results = await multiSearch(entry.title, entry.year, entry.quality, entry.category);
        updateWatchlistEntry(id, { lastCheckedAt: Date.now() });
        return c.json({ ok: true, resultCount: results.length, results: results.slice(0, 50) });
    } catch (err) {
        const msg = (err as Error).message;
        log('ERROR', `[watchlist] Search failed for ${id}: ${msg}`);
        return c.json({ ok: false, error: msg }, 500);
    }
});

// ── POST /api/watchlist/:id/results/:rid/add — add result as torrent ─────

app.post('/api/watchlist/:id/results/:rid/add', async (c) => {
    const id = c.req.param('id');
    const rid = parseInt(c.req.param('rid'), 10);

    const entry = getWatchlistEntry(id);
    if (!entry) {
        return c.json({ ok: false, error: 'Watchlist entry not found' }, 404);
    }

    const results = getWatchlistResults(id);
    const result = results.find(r => r.id === rid);
    if (!result) {
        return c.json({ ok: false, error: 'Result not found' }, 404);
    }

    try {
        const torrent = await getTorrentManager().addTorrent(result.magnetUri);
        markResultSelected(rid);
        updateWatchlistEntry(id, {
            lastMatchAt: Date.now(),
            matchedTorrentId: torrent.id,
            status: 'fulfilled',
        });
        return c.json({ ok: true, torrent });
    } catch (err) {
        return c.json({ ok: false, error: (err as Error).message }, 400);
    }
});

// ── POST /api/watchlist/check — trigger global check ─────────────────────

app.post('/api/watchlist/check', async (c) => {
    try {
        await runWatchlistCheck();
        return c.json({ ok: true });
    } catch (err) {
        return c.json({ ok: false, error: (err as Error).message }, 500);
    }
});

export default app;
