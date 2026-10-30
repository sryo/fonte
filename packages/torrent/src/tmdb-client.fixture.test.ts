import { describe, it, expect, afterEach, vi } from 'vitest';
import { searchTmdb, searchTmdbMulti } from './tmdb-client';
import { createTmdbFetch } from '../../testing/src/tmdb-fake';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('tmdb-client against the TMDB fixtures', () => {
    it('resolves a movie to its id, original title and poster', async () => {
        const tmdb = createTmdbFetch({ apiKey: 'k' });
        vi.stubGlobal('fetch', tmdb.fetch);

        const info = await searchTmdb({ title: 'Blade Runner', year: 1982, mediaType: 'movie', apiKey: 'k' });

        expect(info).toEqual({
            tmdbId: 78,
            title: 'Blade Runner',
            originalTitle: 'Blade Runner',
            originalLanguage: 'en',
            year: 1982,
            mediaType: 'movie',
            posterUrl: 'https://image.tmdb.org/t/p/w300/63N9uy8nd9j7Eog2axPQ8lbr3Wj.jpg',
        });
        expect(tmdb.requests).toHaveLength(1);
        expect(tmdb.requests[0].path).toBe('/3/search/movie');
        expect(tmdb.requests[0].query.get('year')).toBe('1982');
    });

    it('returns null for a title TMDB does not know', async () => {
        vi.stubGlobal('fetch', createTmdbFetch().fetch);

        expect(await searchTmdb({ title: 'Nothing Like This', mediaType: 'tv', apiKey: 'k' })).toBeNull();
    });

    it('fails like TMDB does on a bad API key', async () => {
        vi.stubGlobal('fetch', createTmdbFetch({ apiKey: 'right' }).fetch);

        await expect(searchTmdbMulti({ query: 'blade runner', apiKey: 'wrong' })).rejects.toThrow('TMDB search failed (401)');
    });

    it('serves multi-search suggestions from the fixtures', async () => {
        vi.stubGlobal('fetch', createTmdbFetch().fetch);

        const found = await searchTmdbMulti({ query: 'Blade Runner', apiKey: 'k' });

        expect(found).toEqual([
            { title: 'Blade Runner', year: 1982, mediaType: 'movie' },
            { title: 'Blade Runner 2049', year: 2017, mediaType: 'movie' },
            { title: 'Blade Runner: Black Lotus', year: 2021, mediaType: 'tv' },
        ]);
    });
});
