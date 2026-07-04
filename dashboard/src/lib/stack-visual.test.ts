// Runs via root `npm test` (vitest's default glob sweeps the dashboard even
// though it isn't a workspace). Imports must stay relative — nothing maps the
// "@/" alias outside Next.

import { describe, it, expect } from 'vitest';
import { stackDepthForCount, stackTilt } from './stack-visual';

describe('stackDepthForCount', () => {
    it('maps counts to pile depth', () => {
        expect(stackDepthForCount(0)).toBe(0);
        expect(stackDepthForCount(1)).toBe(0);
        expect(stackDepthForCount(2)).toBe(1);
        expect(stackDepthForCount(5)).toBe(1);
        expect(stackDepthForCount(6)).toBe(2);
        expect(stackDepthForCount(159)).toBe(2);
    });
});

describe('stackTilt', () => {
    it('is deterministic for the same seed and layer', () => {
        expect(stackTilt('wl_abc', 0)).toEqual(stackTilt('wl_abc', 0));
        expect(stackTilt('wl_abc', 1)).toEqual(stackTilt('wl_abc', 1));
    });

    it('stays within visual bounds', () => {
        for (const seed of ['wl_1', 'wl_2', 'fulfilled-tray', 'x']) {
            for (const layer of [0, 1]) {
                const { angle, dx, dy } = stackTilt(seed, layer);
                expect(Math.abs(angle)).toBeGreaterThanOrEqual(1);
                expect(Math.abs(angle)).toBeLessThanOrEqual(3);
                expect(Math.abs(dx)).toBeGreaterThanOrEqual(2);
                expect(Math.abs(dx)).toBeLessThanOrEqual(6);
                expect(dy).toBeGreaterThanOrEqual(2);
                expect(dy).toBeLessThanOrEqual(6);
            }
        }
    });

    it('alternates sides between layers', () => {
        const a = stackTilt('wl_abc', 0);
        const b = stackTilt('wl_abc', 1);
        expect(Math.sign(a.angle)).not.toBe(Math.sign(b.angle));
        expect(Math.sign(a.dx)).not.toBe(Math.sign(b.dx));
    });

    it('differs between seeds', () => {
        expect(stackTilt('wl_one', 0)).not.toEqual(stackTilt('wl_two', 0));
    });
});
