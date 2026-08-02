// Snap math for the two resize drags (card corner grip, content-edge
// hairline). Detents are the values where an integer number of 1x cards
// exactly fills a home row. Pure — no DOM, no React.

export const GRID_GAP = 12;
export const CONTENT_PAD = 48;

// Floor so a full row of n cards can never exceed rowW (max slack n * 0.25px).
const floorToQuarter = (x: number) => Math.floor(x * 4) / 4;

/** Card widths at which n cards + gaps exactly fill rowW, within [min, max]. */
export function cardSnapCandidates(rowW: number, min: number, max: number): number[] {
  const out: number[] = [];
  for (let n = 1; ; n++) {
    const c = floorToQuarter((rowW - (n - 1) * GRID_GAP) / n);
    if (c < min) break;
    if (c <= max) out.push(c);
  }
  return out.reverse();
}

/** Content widths at which n cards of width cardW exactly fill the row, within [min, max]. */
export function widthSnapCandidates(cardW: number, min: number, max: number): number[] {
  const out: number[] = [];
  for (let n = 1; ; n++) {
    const w = n * cardW + (n - 1) * GRID_GAP + CONTENT_PAD;
    if (w > max) break;
    if (w >= min) out.push(w);
  }
  return out;
}

/** Magnetic detent with capture/release hysteresis. `raw` must be recomputed
    from the absolute pointer position each move, so escaping a detent lands
    the value exactly under the cursor. Radii shrink near dense candidates so
    free zones always survive between adjacent detents. */
export function snapStep(
  raw: number,
  candidates: number[],
  latched: number | null,
  capture: number,
  release: number
): { value: number; latched: number | null } {
  const neighborGap = (c: number) => {
    const i = candidates.indexOf(c);
    const left = i > 0 ? c - candidates[i - 1] : Infinity;
    const right = i < candidates.length - 1 ? candidates[i + 1] - c : Infinity;
    return Math.min(left, right);
  };

  if (latched !== null && candidates.includes(latched)) {
    const effRelease = Math.min(release, 0.66 * neighborGap(latched));
    if (Math.abs(raw - latched) <= effRelease) return { value: latched, latched };
  }

  let nearest: number | null = null;
  for (const c of candidates) {
    if (nearest === null || Math.abs(raw - c) < Math.abs(raw - nearest)) nearest = c;
  }
  if (nearest !== null) {
    const effCapture = Math.min(capture, 0.33 * neighborGap(nearest));
    if (Math.abs(raw - nearest) <= effCapture) return { value: nearest, latched: nearest };
  }
  return { value: raw, latched: null };
}
