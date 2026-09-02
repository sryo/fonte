import type { WatchlistSuggestion } from './types';

export interface TmdbMediaInfo {
    tmdbId: number;
    title: string;
    originalTitle: string;
    originalLanguage: string;
    year: number;
    mediaType: 'movie' | 'tv';
    posterUrl?: string;
}

async function tmdbSearch(path: string, params: Record<string, string>): Promise<any[]> {
    const url = new URL(`https://api.themoviedb.org/3/search/${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`TMDB search failed (${res.status})`);

    const data = await res.json() as { results?: any[] };
    return data.results || [];
}

const posterUrl = (path?: string) => (path ? `https://image.tmdb.org/t/p/w300${path}` : undefined);

/** TMDB dates are "YYYY-MM-DD", and absent for unreleased entries. */
function releaseYear(result: any): number | undefined {
    const date = result.release_date || result.first_air_date || '';
    const year = date ? parseInt(date.slice(0, 4), 10) : NaN;
    return Number.isFinite(year) ? year : undefined;
}

/**
 * Title-ahead lookup across film and television in one call. Unlike
 * searchTmdb, which resolves a known entry to its poster, this ranks
 * candidates for a user who is still typing.
 */
export async function searchTmdbMulti(opts: {
    query: string;
    apiKey: string;
    limit?: number;
}): Promise<WatchlistSuggestion[]> {
    const { query, apiKey, limit = 8 } = opts;
    if (!query.trim()) return [];

    const results = await tmdbSearch('multi', { api_key: apiKey, query });
    return results
        .filter(r => (r.media_type === 'movie' || r.media_type === 'tv') && (r.title || r.name))
        .slice(0, limit)
        .map(r => ({
            title: r.title || r.name,
            year: releaseYear(r),
            mediaType: r.media_type as 'movie' | 'tv',
        }));
}

export async function searchTmdb(opts: {
    title: string;
    year?: number;
    mediaType: 'movie' | 'tv';
    apiKey: string;
}): Promise<TmdbMediaInfo | null> {
    const { title, year, mediaType, apiKey } = opts;

    const url = new URL(`https://api.themoviedb.org/3/search/${mediaType}`);
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('query', title);
    if (year) url.searchParams.set('year', String(year));

    const res = await fetch(url.toString(), {
        signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
        throw new Error(`TMDB search failed (${res.status})`);
    }

    const data = await res.json() as { results?: any[] };
    const results = data.results || [];
    if (results.length === 0) return null;

    const top = results[0];
    const releaseDate = top.release_date || top.first_air_date || '';

    return {
        tmdbId: top.id,
        title: top.title || top.name || title,
        originalTitle: top.original_title || top.original_name || title,
        originalLanguage: top.original_language || 'en',
        year: releaseDate ? parseInt(releaseDate.slice(0, 4), 10) : 0,
        mediaType,
        posterUrl: top.poster_path ? `https://image.tmdb.org/t/p/w300${top.poster_path}` : undefined,
    };
}
