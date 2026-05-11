export interface TmdbMediaInfo {
    tmdbId: number;
    title: string;
    originalTitle: string;
    originalLanguage: string;
    year: number;
    mediaType: 'movie' | 'tv';
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
    };
}
