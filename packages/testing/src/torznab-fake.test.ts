import { describe, it, expect, afterEach } from 'vitest';
import { startTorznabFake, type TorznabFake } from './torznab-fake';

let fake: TorznabFake;

afterEach(async () => {
    await fake?.close();
});

const torznab = (indexer: string, params: Record<string, string>) =>
    fetch(`${fake.url}/api/v2.0/indexers/${indexer}/results/torznab/api?${new URLSearchParams({ apikey: 'key', ...params })}`);

describe('startTorznabFake', () => {
    it('serves caps', async () => {
        fake = await startTorznabFake({ indexers: [{ id: 'alpha' }] });

        const xml = await (await torznab('alpha', { t: 'caps' })).text();

        expect(xml).toContain('<tv-search available="yes" supportedParams="q,season,ep,imdbid" />');
    });

    it('answers each search function with per-query RSS items', async () => {
        fake = await startTorznabFake({
            indexers: [{
                id: 'alpha',
                name: 'Alpha & Co',
                results: q => q.t === 'tvsearch' && q.params.get('season') === '2'
                    ? [{ title: 'Show S02 <1080p>', infoHash: 'ef'.repeat(20), seeders: 4, category: [5040] }]
                    : [],
            }],
        });

        const hit = await (await torznab('alpha', { t: 'tvsearch', q: 'show', season: '2', cat: '5000,5040' })).text();
        const miss = await (await torznab('alpha', { t: 'movie', q: 'show' })).text();

        expect(hit).toContain('<title>Show S02 &lt;1080p&gt;</title>');
        expect(hit).toContain('<jackettindexer id="alpha">Alpha &amp; Co</jackettindexer>');
        expect(hit).toContain('<torznab:attr name="seeders" value="4" />');
        expect(hit).toContain(`<torznab:attr name="infohash" value="${'ef'.repeat(20)}" />`);
        expect(miss).not.toContain('<item>');
        expect(fake.requests.map(r => r.query.get('t'))).toEqual(['tvsearch', 'movie']);
    });

    it('returns torznab errors with a 200 and HTTP failures as-is', async () => {
        fake = await startTorznabFake({
            indexers: [
                { id: 'blocked', fail: { torznabError: { code: 900, description: 'Challenge detected' } } },
                { id: 'down', fail: { status: 502, body: 'bad gateway' } },
            ],
        });

        const blocked = await torznab('blocked', { t: 'search', q: 'x' });
        const down = await torznab('down', { t: 'search', q: 'x' });

        expect(blocked.status).toBe(200);
        expect(await blocked.text()).toContain('<error code="900" description="Challenge detected" />');
        expect(down.status).toBe(502);
        expect(await down.text()).toBe('bad gateway');
    });

    it('rejects a wrong API key and an unknown function', async () => {
        fake = await startTorznabFake({ apiKey: 'other', indexers: [{ id: 'alpha' }] });
        expect((await torznab('alpha', { t: 'search' })).status).toBe(401);

        await fake.close();
        fake = await startTorznabFake({ indexers: [{ id: 'alpha' }] });
        expect(await (await torznab('alpha', { t: 'book' })).text()).toContain('code="202"');
    });
});
