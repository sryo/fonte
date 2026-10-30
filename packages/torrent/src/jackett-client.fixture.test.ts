import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { startTorznabFake, type TorznabFake } from '../../testing/src/torznab-fake';

const HASH = 'cd'.repeat(20);
let home: string;
let jackett: typeof import('./jackett-client');
let fake: TorznabFake;

beforeAll(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'fonte-jackett-fixture-'));
    fs.mkdirSync(path.join(home, 'logs'));
    process.env.FONTE_HOME = home;
    jackett = await import('./jackett-client');
});

afterAll(() => {
    delete process.env.FONTE_HOME;
    fs.rmSync(home, { recursive: true, force: true });
});

beforeEach(() => {
    jackett.resetJackettIndexerCache();
});

afterEach(async () => {
    await fake?.close();
});

describe('searchJackett against a fixture server', () => {
    it('searches each configured indexer and maps its results', async () => {
        fake = await startTorznabFake({
            apiKey: 'key',
            indexers: [
                {
                    id: 'alpha',
                    name: 'Alpha',
                    results: q => q.q === 'some show'
                        ? [{ title: 'Some Show S01E01 1080p', infoHash: HASH, size: 1_500_000_000, seeders: 12, peers: 3, category: [5040] }]
                        : [],
                },
                { id: 'beta', name: 'Beta', results: [] },
            ],
        });

        const out = await jackett.searchJackett({ query: 'some show', categories: [5000], jackettUrl: fake.url, apiKey: 'key' });

        expect(out.results).toEqual([{
            title: 'Some Show S01E01 1080p',
            magnetUri: expect.stringContaining(`xt=urn:btih:${HASH}`),
            seeders: 12,
            leechers: 3,
            size: 1_500_000_000,
            publishDate: expect.any(Number),
            indexer: 'Alpha',
            category: [5040],
        }]);
        expect(out.sources).toEqual([
            expect.objectContaining({ indexer: 'Alpha', ok: true, results: 1 }),
            expect.objectContaining({ indexer: 'Beta', ok: true, results: 0 }),
        ]);
        const search = fake.requests.find(r => r.path === '/api/v2.0/indexers/alpha/results')!;
        expect(search.query.get('Query')).toBe('some show');
        expect(search.query.getAll('Category[]')).toEqual(['5000']);
    });

    it('reports a failing indexer without losing the healthy one', async () => {
        fake = await startTorznabFake({
            indexers: [
                { id: 'alpha', name: 'Alpha', results: [{ title: 'Some Show S01', infoHash: HASH }] },
                { id: 'beta', name: 'Beta', fail: { torznabError: { code: 900, description: 'Challenge detected' } } },
                { id: 'gamma', name: 'Gamma', fail: { status: 500, body: 'upstream exploded' } },
            ],
        });

        const out = await jackett.searchJackett({ query: 'some show', jackettUrl: fake.url, apiKey: 'key' });

        expect(out.results.map(r => r.title)).toEqual(['Some Show S01']);
        expect(out.sources).toEqual([
            expect.objectContaining({ indexer: 'Alpha', ok: true, results: 1 }),
            expect.objectContaining({ indexer: 'Beta', ok: false, error: 'Challenge detected', results: 0 }),
            expect.objectContaining({ indexer: 'Gamma', ok: false, error: 'Jackett search failed (500): upstream exploded', results: 0 }),
        ]);
    });

    it('falls back to the aggregate search when the indexer list fails', async () => {
        fake = await startTorznabFake({
            indexers: [{ id: 'alpha', name: 'Alpha', results: [{ title: 'Some Show S01', infoHash: HASH }] }],
            failIndexerList: { status: 500 },
        });

        const out = await jackett.searchJackett({ query: 'some show', jackettUrl: fake.url, apiKey: 'key' });

        expect(out.results.map(r => r.title)).toEqual(['Some Show S01']);
        expect(out.sources).toEqual([expect.objectContaining({ indexer: 'jackett', ok: true, results: 1 })]);
        expect(fake.requests.some(r => r.path === '/api/v2.0/indexers/all/results')).toBe(true);
    });

    it('surfaces a rejected API key from the aggregate search', async () => {
        fake = await startTorznabFake({ apiKey: 'right', indexers: [] });

        await expect(jackett.searchJackett({ query: 'x', jackettUrl: fake.url, apiKey: 'wrong' })).rejects.toThrow('Jackett search failed (401)');
    });
});
