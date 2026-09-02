import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { searchJackett, listJackettIndexers, resetJackettIndexerCache } from './jackett-client';

const INDEXERS_XML = `<?xml version="1.0"?><indexers>
  <indexer id="thepiratebay" configured="true"><title>The Pirate Bay</title></indexer>
  <indexer id="eztv" configured="true"><title>EZTV</title></indexer>
</indexers>`;

const opts = { query: 'show', categories: [5000], jackettUrl: 'http://jackett.local:9117', apiKey: 'key' };

function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
    resetJackettIndexerCache();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('listJackettIndexers', () => {
    it('parses the torznab listing and caches it', async () => {
        fetchMock.mockResolvedValue(new Response(INDEXERS_XML, { status: 200 }));
        const first = await listJackettIndexers(opts.jackettUrl, opts.apiKey);
        expect(first).toEqual([{ id: 'thepiratebay', name: 'The Pirate Bay' }, { id: 'eztv', name: 'EZTV' }]);
        await listJackettIndexers(opts.jackettUrl, opts.apiKey);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toContain('t=indexers');
    });
});

describe('searchJackett', () => {
    it('queries each indexer separately and keeps the ones that answered', async () => {
        fetchMock.mockImplementation(async (url: string) => {
            if (url.includes('t=indexers')) return new Response(INDEXERS_XML, { status: 200 });
            if (url.includes('/indexers/thepiratebay/results')) {
                return jsonResponse({
                    Results: [{ Title: 'Show S01', MagnetUri: 'magnet:?xt=urn:btih:abc', Seeders: 9, Peers: 1, Size: 10, Tracker: 'The Pirate Bay' }],
                    Indexers: [{ ID: 'thepiratebay', Name: 'The Pirate Bay', Status: 2, Results: 1 }],
                });
            }
            if (url.includes('/indexers/eztv/results')) {
                return jsonResponse({
                    Results: [],
                    Indexers: [{ ID: 'eztv', Name: 'EZTV', Status: 1, Results: 0, Error: 'Jackett.Common.IndexerException: Exception (eztv): Challenge detected' }],
                });
            }
            throw new Error(`unexpected url ${url}`);
        });

        const out = await searchJackett(opts);

        expect(out.results.map(r => r.title)).toEqual(['Show S01']);
        expect(out.sources).toEqual([
            expect.objectContaining({ indexer: 'The Pirate Bay', ok: true, results: 1 }),
            expect.objectContaining({ indexer: 'EZTV', ok: false, error: 'Challenge detected', results: 0 }),
        ]);
        const urls = fetchMock.mock.calls.map(c => c[0]);
        expect(urls.filter(u => u.includes('/results?')).every(u => u.includes('Query=show') && u.includes('Category%5B%5D=5000'))).toBe(true);
    });

    it('reports a timed-out indexer without losing the others', async () => {
        fetchMock.mockImplementation(async (url: string) => {
            if (url.includes('t=indexers')) return new Response(INDEXERS_XML, { status: 200 });
            if (url.includes('/indexers/eztv/results')) {
                const err = new Error('The operation was aborted due to timeout');
                err.name = 'TimeoutError';
                throw err;
            }
            return jsonResponse({ Results: [{ Title: 'Show', MagnetUri: 'magnet:?xt=urn:btih:abc', Tracker: 'The Pirate Bay' }], Indexers: [] });
        });

        const out = await searchJackett(opts);
        expect(out.results).toHaveLength(1);
        expect(out.sources.find(s => s.indexer === 'EZTV')).toMatchObject({ ok: false, error: 'timed out' });
    });

    it('falls back to the aggregate endpoint when the indexer list is unavailable', async () => {
        fetchMock.mockImplementation(async (url: string) => {
            if (url.includes('t=indexers')) return new Response('nope', { status: 500 });
            if (url.includes('/indexers/all/results')) {
                return jsonResponse({ Results: [{ Title: 'Show', MagnetUri: 'magnet:?xt=urn:btih:abc', Tracker: 'X' }] });
            }
            throw new Error(`unexpected url ${url}`);
        });

        const out = await searchJackett(opts);
        expect(out.results).toHaveLength(1);
        expect(out.sources).toEqual([expect.objectContaining({ indexer: 'jackett', ok: true, results: 1 })]);
    });
});
