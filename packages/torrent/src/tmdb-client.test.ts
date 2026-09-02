import { describe, it, expect, vi, afterEach } from 'vitest';
import { searchTmdbMulti } from './tmdb-client';

afterEach(() => {
    vi.unstubAllGlobals();
});

function stubResults(results: unknown[]) {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ results }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

describe('searchTmdbMulti', () => {
    it('keeps film and television, drops everything else', async () => {
        stubResults([
            { media_type: 'person', name: 'Ridley Scott' },
            { media_type: 'movie', title: 'Blade Runner', release_date: '1982-06-25', poster_path: '/br.jpg' },
            { media_type: 'tv', name: 'Blade Runner: Black Lotus', first_air_date: '2021-11-13' },
        ]);

        const found = await searchTmdbMulti({ query: 'blade runner', apiKey: 'k' });

        expect(found).toEqual([
            { title: 'Blade Runner', year: 1982, mediaType: 'movie' },
            { title: 'Blade Runner: Black Lotus', year: 2021, mediaType: 'tv' },
        ]);
    });

    it('leaves the year undefined when TMDB has no release date', async () => {
        stubResults([{ media_type: 'movie', title: 'Untitled Project', release_date: '' }]);

        const [only] = await searchTmdbMulti({ query: 'untitled', apiKey: 'k' });

        expect(only.year).toBeUndefined();
    });

    it('caps the list at the requested limit', async () => {
        stubResults(Array.from({ length: 20 }, (_, i) => ({ media_type: 'movie', title: `Film ${i}` })));

        expect(await searchTmdbMulti({ query: 'film', apiKey: 'k', limit: 3 })).toHaveLength(3);
    });

    it('never calls TMDB for a blank query', async () => {
        const fetchMock = stubResults([]);

        expect(await searchTmdbMulti({ query: '   ', apiKey: 'k' })).toEqual([]);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws on an API error so the caller can fall back', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })));

        await expect(searchTmdbMulti({ query: 'blade', apiKey: 'bad' })).rejects.toThrow('TMDB search failed (401)');
    });
});
