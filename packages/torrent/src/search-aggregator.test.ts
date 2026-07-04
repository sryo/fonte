import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    parseSizeString, extractInfoHash, filterByTitle,
    computeQualityMatch, computeScore, rankResults, sortBySeedersThenSize,
    aggregateSearch,
} from './search-aggregator';
import { searchJackett } from './jackett-client';
import { searchBt4g } from './bt4g-client';

vi.mock('./jackett-client', () => ({ searchJackett: vi.fn() }));
vi.mock('./bt4g-client', () => ({ searchBt4g: vi.fn() }));

describe('parseSizeString', () => {
    it('parses common units', () => {
        expect(parseSizeString('1.4 GB')).toBe(Math.round(1.4 * 1024 ** 3));
        expect(parseSizeString('700 MB')).toBe(700 * 1024 ** 2);
        expect(parseSizeString('512KB')).toBe(512 * 1024);
        expect(parseSizeString('2 TB')).toBe(2 * 1024 ** 4);
    });

    it('is case-insensitive', () => {
        expect(parseSizeString('1.5 gb')).toBe(Math.round(1.5 * 1024 ** 3));
    });

    it('returns 0 for empty or unparseable input', () => {
        expect(parseSizeString('')).toBe(0);
        expect(parseSizeString('unknown')).toBe(0);
        expect(parseSizeString('123')).toBe(0);
    });
});

describe('extractInfoHash', () => {
    const hex = '8acade7b990df0dcc8996f3107a1fa28a9a0cf66';

    it('extracts a 40-char hex hash, lowercased', () => {
        expect(extractInfoHash(`magnet:?xt=urn:btih:${hex}&dn=x`)).toBe(hex);
        expect(extractInfoHash(`magnet:?xt=urn:btih:${hex.toUpperCase()}`)).toBe(hex);
    });

    it('decodes a base32 hash to 40-char lowercase hex', () => {
        const b32 = 'RLFN464ZBXYNZSEZN4YQPIP2FCU2BT3G'; // base32 encoding of `hex`
        expect(extractInfoHash(`magnet:?xt=urn:btih:${b32}`)).toBe(hex);
        expect(extractInfoHash(`magnet:?xt=urn:btih:${b32.toLowerCase()}`)).toBe(hex);
    });

    it('returns undefined when no hash is present', () => {
        expect(extractInfoHash('magnet:?dn=no-hash')).toBeUndefined();
        expect(extractInfoHash('')).toBeUndefined();
    });
});

describe('filterByTitle', () => {
    const results = [
        { title: 'The Matrix 1999 1080p BluRay' },
        { title: 'The Matrix Reloaded 2003 720p' },
        { title: 'Matrix Documentary 2020' },
        { title: 'Severance S02E01 2025 2160p' },
    ];

    it('requires every word of the wanted title', () => {
        const out = filterByTitle(results, { title: 'The Matrix' });
        expect(out.map(r => r.title)).toEqual([
            'The Matrix 1999 1080p BluRay',
            'The Matrix Reloaded 2003 720p',
        ]);
    });

    it('requires the year when specified', () => {
        const out = filterByTitle(results, { title: 'The Matrix', year: 1999 });
        expect(out).toHaveLength(1);
        expect(out[0].title).toBe('The Matrix 1999 1080p BluRay');
    });

    it('requires the season pattern case-insensitively', () => {
        const out = filterByTitle(results, { title: 'Severance', seasonPattern: 's02' });
        expect(out).toHaveLength(1);
        expect(filterByTitle(results, { title: 'Severance', seasonPattern: 'S03' })).toHaveLength(0);
    });

    it('matches title words case-insensitively', () => {
        expect(filterByTitle(results, { title: 'the MATRIX reloaded' })).toHaveLength(1);
    });
});

describe('computeQualityMatch', () => {
    it('returns 1.0 for an exact quality match', () => {
        expect(computeQualityMatch('Movie 2024 1080p WEB-DL', '1080p')).toBe(1.0);
    });

    it('returns 0.5 for an adjacent quality', () => {
        expect(computeQualityMatch('Movie 2024 720p', '1080p')).toBe(0.5);
        expect(computeQualityMatch('Movie 2024 2160p', '4k')).toBe(0.5);
    });

    it('returns 0.1 when quality is absent or unrelated', () => {
        expect(computeQualityMatch('Movie 2024 480p', '1080p')).toBe(0.1);
        expect(computeQualityMatch('Movie 2024', '1080p')).toBe(0.1);
    });
});

describe('computeScore / rankResults', () => {
    it('weights quality 0.6, seeders 0.3, recency 0.1', () => {
        const fresh = { title: 'X 1080p', seeders: 100, publishDate: Date.now() };
        expect(computeScore(fresh, '1080p')).toBeCloseTo(1.0, 2);

        const stale = { title: 'X 1080p', seeders: 0, publishDate: undefined };
        expect(computeScore(stale, '1080p')).toBeCloseTo(0.6, 5);
    });

    it('caps the seeder contribution at 100 seeders', () => {
        const a = { title: 'X', seeders: 100 };
        const b = { title: 'X', seeders: 10000 };
        expect(computeScore(a, '1080p')).toBe(computeScore(b, '1080p'));
    });

    it('ranks preferred quality above higher seeders of the wrong quality', () => {
        const ranked = rankResults([
            { title: 'X 720p', seeders: 100 },
            { title: 'X 1080p', seeders: 10 },
        ], '1080p');
        expect(ranked[0].title).toBe('X 1080p');
    });
});

describe('sortBySeedersThenSize', () => {
    it('sorts by seeders desc, then size desc', () => {
        const sorted = sortBySeedersThenSize([
            { seeders: 5, size: 100 },
            { seeders: 10, size: 50 },
            { seeders: 10, size: 200 },
            { seeders: 0, size: 999 },
        ]);
        expect(sorted).toEqual([
            { seeders: 10, size: 200 },
            { seeders: 10, size: 50 },
            { seeders: 5, size: 100 },
            { seeders: 0, size: 999 },
        ]);
    });

    it('treats missing seeders/size as 0 and does not mutate the input', () => {
        const input = [{ seeders: undefined, size: 10 }, { seeders: 1, size: undefined }];
        const sorted = sortBySeedersThenSize(input);
        expect(sorted[0]).toEqual({ seeders: 1, size: undefined });
        expect(input[0]).toEqual({ seeders: undefined, size: 10 });
    });
});

describe('computeQualityMatch with a 2160p preference', () => {
    it('scores exact 2160p at 1.0 and 1080p/4k as adjacent', () => {
        expect(computeQualityMatch('Movie 2024 2160p WEB-DL', '2160p')).toBe(1.0);
        expect(computeQualityMatch('Movie 2024 1080p', '2160p')).toBe(0.5);
        expect(computeQualityMatch('Movie 2024 4K HDR', '2160p')).toBe(0.5);
    });

    it('does not treat 720p as adjacent to 2160p', () => {
        expect(computeQualityMatch('Movie 2024 720p', '2160p')).toBe(0.1);
    });
});

describe('rankResults quality preference and seeder demotion', () => {
    it('ranks 2160p vs 1080p according to the preferred quality', () => {
        const results = [
            { title: 'X 1080p', seeders: 50 },
            { title: 'X 2160p', seeders: 50 },
        ];
        expect(rankResults(results, '2160p')[0].title).toBe('X 2160p');
        expect(rankResults(results, '1080p')[0].title).toBe('X 1080p');
    });

    it('demotes a zero-seeder copy below a seeded copy of the same quality', () => {
        const ranked = rankResults([
            { title: 'Dead 1080p', seeders: 0 },
            { title: 'Alive 1080p', seeders: 30 },
        ], '1080p');
        expect(ranked.map(r => r.title)).toEqual(['Alive 1080p', 'Dead 1080p']);
    });

    it('breaks a composite-score tie by seeders desc', () => {
        // 1.0*0.6 + 0 equals 0.5*0.6 + 0.3, so the seeded copy wins the
        // tiebreak regardless of input order
        const zeroSeederExact = { title: 'X 1080p', seeders: 0 };
        const seededAdjacent = { title: 'X 720p', seeders: 100 };
        expect(computeScore(zeroSeederExact, '1080p')).toBe(computeScore(seededAdjacent, '1080p'));
        expect(rankResults([seededAdjacent, zeroSeederExact], '1080p')[0].title).toBe('X 720p');
        expect(rankResults([zeroSeederExact, seededAdjacent], '1080p')[0].title).toBe('X 720p');
    });

    it('breaks a score-and-seeders tie by size desc', () => {
        const small = { title: 'X 1080p', seeders: 10, size: 1_000 };
        const large = { title: 'X 1080p', seeders: 10, size: 2_000 };
        expect(rankResults([small, large], '1080p').map(r => r.size)).toEqual([2_000, 1_000]);
    });
});

describe('aggregateSearch info-hash dedup', () => {
    const b32 = 'RLFNM6442KMUEILUWLLO2RUWUCU2BT2M';
    const jackettOpts = { jackettUrl: 'http://jackett.local:9117', apiKey: 'key' };

    const jackettResult = (title: string, magnetUri: string) => ({
        title, magnetUri, seeders: 5, leechers: 0, size: 0, indexer: 'idx', category: [],
    });
    const bt4gResult = (title: string, magnetUri: string, infoHash = '') => ({
        title, magnetUri, size: '1 GB', category: 'movie', infoHash,
    });

    beforeEach(() => {
        vi.mocked(searchJackett).mockReset().mockResolvedValue([]);
        vi.mocked(searchBt4g).mockReset().mockResolvedValue([]);
    });

    it('dedupes base32 hashes across sources case-insensitively', async () => {
        vi.mocked(searchJackett).mockResolvedValue([
            jackettResult('From Jackett', `magnet:?xt=urn:btih:${b32}`),
        ]);
        vi.mocked(searchBt4g).mockResolvedValue([
            bt4gResult('From bt4g', `magnet:?xt=urn:btih:${b32.toLowerCase()}`),
        ]);

        const out = await aggregateSearch(['query'], jackettOpts);
        expect(out).toHaveLength(1);
        expect(out[0].title).toBe('From Jackett');
        expect(out[0].source).toBe('idx');
    });

    it('dedupes via the bt4g infoHash field when the magnet lacks a hash', async () => {
        vi.mocked(searchJackett).mockResolvedValue([
            jackettResult('From Jackett', `magnet:?xt=urn:btih:${b32}`),
        ]);
        vi.mocked(searchBt4g).mockResolvedValue([
            bt4gResult('From bt4g', 'magnet:?dn=no-hash-here', b32),
        ]);

        const out = await aggregateSearch(['query'], jackettOpts);
        expect(out).toHaveLength(1);
        expect(out[0].title).toBe('From Jackett');
    });

    it('dedupes hex and base32 encodings of the same hash', async () => {
        const hex = '8acade7b990df0dcc8996f3107a1fa28a9a0cf66';
        const sameHashB32 = 'RLFN464ZBXYNZSEZN4YQPIP2FCU2BT3G';
        vi.mocked(searchJackett).mockResolvedValue([
            jackettResult('Hex form', `magnet:?xt=urn:btih:${hex}`),
            jackettResult('Base32 form', `magnet:?xt=urn:btih:${sameHashB32}`),
        ]);

        const out = await aggregateSearch(['query'], jackettOpts);
        expect(out.map(r => r.title)).toEqual(['Hex form']);
    });

    it('dedupes a base32 magnet against a hex bt4g infoHash field', async () => {
        const hex = '8acade7b990df0dcc8996f3107a1fa28a9a0cf66';
        const sameHashB32 = 'RLFN464ZBXYNZSEZN4YQPIP2FCU2BT3G';
        vi.mocked(searchJackett).mockResolvedValue([
            jackettResult('From Jackett', `magnet:?xt=urn:btih:${sameHashB32}`),
        ]);
        vi.mocked(searchBt4g).mockResolvedValue([
            bt4gResult('From bt4g', 'magnet:?dn=no-hash-here', hex),
        ]);

        const out = await aggregateSearch(['query'], jackettOpts);
        expect(out).toHaveLength(1);
        expect(out[0].title).toBe('From Jackett');
    });
});
