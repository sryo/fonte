// Pure geometry for the "disordered pile" card stacks on the home page.
// Imports stay relative (no "@/") so the root vitest run can resolve them.

export type StackDepth = 0 | 1 | 2;

/** One new item is just a badge; a pile implies plural. */
export function stackDepthForCount(count: number): StackDepth {
    if (count >= 6) return 2;
    if (count >= 2) return 1;
    return 0;
}

export interface StackTilt {
    /** degrees */
    angle: number;
    /** px */
    dx: number;
    /** px */
    dy: number;
}

// FNV-1a. The disorder must be stable across re-renders (home polls every
// 3s) yet differ between cards, so it derives from the card's seed.
function hash(str: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Tilt for ghost layer `layer` (0 = closest to the card). Angle ±1–3°, offsets 2–6px, alternating sides. */
export function stackTilt(seed: string, layer: number): StackTilt {
    const h = hash(`${seed}#${layer}`);
    const sign = layer % 2 === 0 ? 1 : -1;
    const angle = sign * (1 + (h % 200) / 100);
    const dx = sign * (2 + ((h >>> 8) % 40) / 10);
    const dy = 2 + ((h >>> 16) % 40) / 10;
    return { angle: round2(angle), dx: round2(dx), dy: round2(dy) };
}
