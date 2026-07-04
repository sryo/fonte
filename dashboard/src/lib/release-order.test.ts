// Runs via root `npm test` (vitest's default glob sweeps the dashboard even
// though it isn't a workspace). Imports must stay relative — nothing maps the
// "@/" alias outside Next.

import { describe, it, expect } from 'vitest';
import { sortReleases, type ReleaseSortable } from './release-order';

let seq = 0;
function makeRelease(overrides: Partial<ReleaseSortable> = {}): ReleaseSortable {
    seq++;
    return {
        title: `Release ${seq}`,
        seeders: 10,
        size: 1_000_000,
        qualityMatch: 50,
        ...overrides,
    };
}

const titles = (rs: ReleaseSortable[]) => rs.map((r) => r.title);

describe('sortReleases', () => {
    it('match orders by qualityMatch desc, seeders as tiebreak', () => {
        const low = makeRelease({ title: 'low', qualityMatch: 20 });
        const high = makeRelease({ title: 'high', qualityMatch: 90 });
        const highFewSeeders = makeRelease({ title: 'high-few', qualityMatch: 90, seeders: 2 });
        expect(titles(sortReleases([low, highFewSeeders, high], 'match'))).toEqual([
            'high', 'high-few', 'low',
        ]);
    });

    it('seeders orders desc, qualityMatch as tiebreak', () => {
        const few = makeRelease({ title: 'few', seeders: 1, qualityMatch: 100 });
        const many = makeRelease({ title: 'many', seeders: 500, qualityMatch: 10 });
        const manyBetter = makeRelease({ title: 'many-better', seeders: 500, qualityMatch: 80 });
        expect(titles(sortReleases([few, many, manyBetter], 'seeders'))).toEqual([
            'many-better', 'many', 'few',
        ]);
    });

    it('size orders desc', () => {
        const small = makeRelease({ title: 'small', size: 100 });
        const big = makeRelease({ title: 'big', size: 9_000_000_000 });
        expect(titles(sortReleases([small, big], 'size'))).toEqual(['big', 'small']);
    });

    it('newest orders by publishDate desc with undated releases last', () => {
        const old = makeRelease({ title: 'old', publishDate: 1_000 });
        const fresh = makeRelease({ title: 'fresh', publishDate: 9_000 });
        const undated = makeRelease({ title: 'undated', seeders: 999 });
        expect(titles(sortReleases([undated, old, fresh], 'newest'))).toEqual([
            'fresh', 'old', 'undated',
        ]);
    });

    it('name sorts alphabetically, numeric-aware', () => {
        const e2 = makeRelease({ title: 'Show E2' });
        const e10 = makeRelease({ title: 'Show E10' });
        const alpha = makeRelease({ title: 'Alpha' });
        expect(titles(sortReleases([e10, e2, alpha], 'name'))).toEqual([
            'Alpha', 'Show E2', 'Show E10',
        ]);
    });

    it('does not mutate the input array', () => {
        const input = [makeRelease({ seeders: 1 }), makeRelease({ seeders: 99 })];
        const copy = [...input];
        sortReleases(input, 'seeders');
        expect(input).toEqual(copy);
    });
});
