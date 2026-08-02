// Runs via root `npm test` (vitest's default glob sweeps the dashboard even
// though it isn't a workspace). Imports must stay relative — nothing maps the
// "@/" alias outside Next.

import { describe, it, expect } from 'vitest';
import { GRID_GAP, cardSnapCandidates, widthSnapCandidates, snapStep } from './grid-snap';

describe('cardSnapCandidates', () => {
    it('matches the perfect-fit table at the default width (rowW 1104)', () => {
        expect(cardSnapCandidates(1104, 120, 360)).toEqual([127.5, 147.25, 174, 211, 267, 360]);
    });

    it('never lets a full row overflow rowW', () => {
        for (const rowW of [720, 1104, 1500, 2352]) {
            const candidates = cardSnapCandidates(rowW, 120, 360);
            for (const c of candidates) {
                const n = Math.round((rowW + GRID_GAP) / (c + GRID_GAP));
                expect(n * c + (n - 1) * GRID_GAP).toBeLessThanOrEqual(rowW);
            }
        }
    });

    it('is sorted ascending and clamped to [min, max]', () => {
        const candidates = cardSnapCandidates(2352, 120, 360);
        expect([...candidates].sort((a, b) => a - b)).toEqual(candidates);
        expect(candidates[0]).toBeGreaterThanOrEqual(120);
        expect(candidates[candidates.length - 1]).toBeLessThanOrEqual(360);
    });
});

describe('widthSnapCandidates', () => {
    it('steps by cardW + gap from the one-card width', () => {
        expect(widthSnapCandidates(176, 768, 2400)).toEqual([788, 976, 1164, 1352, 1540, 1728, 1916, 2104, 2292]);
    });

    it('respects the clamp bounds', () => {
        const ws = widthSnapCandidates(360, 768, 1200);
        expect(ws.every((w) => w >= 768 && w <= 1200)).toBe(true);
    });
});

describe('snapStep', () => {
    const candidates = [127.5, 147.25, 174, 211, 267, 360];

    it('captures within the capture radius and stays latched within release', () => {
        let s = snapStep(176, candidates, null, 6, 10);
        expect(s).toEqual({ value: 174, latched: 174 });
        s = snapStep(182, candidates, s.latched, 6, 10);
        expect(s).toEqual({ value: 174, latched: 174 });
        s = snapStep(185, candidates, s.latched, 6, 10);
        expect(s).toEqual({ value: 185, latched: null });
    });

    it('does not flap at the capture boundary', () => {
        let s = snapStep(174 + 6, candidates, null, 6, 10);
        expect(s.latched).toBe(174);
        s = snapStep(174 + 7, candidates, s.latched, 6, 10);
        expect(s.latched).toBe(174);
        s = snapStep(174 + 6, candidates, s.latched, 6, 10);
        expect(s.latched).toBe(174);
    });

    it('lands exactly under the cursor after escaping', () => {
        let s = snapStep(212, candidates, null, 6, 10);
        expect(s.latched).toBe(211);
        s = snapStep(230, candidates, s.latched, 6, 10);
        expect(s).toEqual({ value: 230, latched: null });
    });

    it('shrinks radii between dense neighbors so a latch cannot cover the next detent', () => {
        const dense = cardSnapCandidates(2352, 120, 360);
        const [a, b] = [dense[0], dense[1]];
        expect(b - a).toBeLessThan(10);
        let s = snapStep(a, dense, null, 6, 10);
        expect(s.latched).toBe(a);
        s = snapStep(b, dense, s.latched, 6, 10);
        expect(s.latched).toBe(b);
    });

    it('passes raw through when there are no candidates', () => {
        expect(snapStep(200, [], null, 6, 10)).toEqual({ value: 200, latched: null });
    });

    it('ignores a stale latch that is no longer a candidate', () => {
        expect(snapStep(200, candidates, 999, 6, 10)).toEqual({ value: 200, latched: null });
    });
});
