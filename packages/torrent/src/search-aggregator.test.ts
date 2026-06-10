import { describe, it, expect } from 'vitest';
import {
    parseSizeString, extractInfoHash, filterByTitle,
    computeQualityMatch, computeScore, rankResults, sortBySeedersThenSize,
} from './search-aggregator';

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

    it('extracts a base32 hash, lowercased', () => {
        const b32 = 'RLFNM6442KMUEILUWLLO2RUWUCU2BT2M';
        expect(extractInfoHash(`magnet:?xt=urn:btih:${b32}`)).toBe(b32.toLowerCase());
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
