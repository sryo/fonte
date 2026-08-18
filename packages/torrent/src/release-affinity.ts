// Learns per-entry release taste from thumbed results. Resolution is
// deliberately not a trait: computeQualityMatch already scores it at
// weight 0.6, and counting it here would double-penalize whole tiers.

const TRAIT_PATTERNS: [string, RegExp][] = [
    ['src:webdl', /\bweb[-. ]?dl\b/],
    ['src:webrip', /\bweb[-. ]?rip\b/],
    ['src:web', /\bweb\b(?![-. ]?(?:dl|rip))/],
    ['src:bluray', /\bblu[-. ]?ray\b/],
    ['src:bdrip', /\b(?:bd|br)[-. ]?rip\b/],
    ['src:hdtv', /\bhdtv\b/],
    ['src:dvdrip', /\bdvd[-. ]?rip\b/],
    ['src:remux', /\bremux\b/],
    ['src:uhd', /\buhd\b/],
    ['codec:h264', /\b[xh][-. ]?264\b|\bavc\b/],
    ['codec:h265', /\b[xh][-. ]?265\b|\bhevc\b/],
    ['codec:av1', /\bav1\b/],
    ['codec:xvid', /\bxvid\b/],
    ['aud:aac', /\baac\b/],
    ['aud:ddp', /\be[-. ]?ac[-. ]?3\b|\bddp\b|\bdd\+/],
    ['aud:dd', /\bac[-. ]?3\b|\bdd\b(?!\+)/],
    ['aud:atmos', /\batmos\b/],
    ['aud:dts', /\bdts(?:[-. ]?hd)?\b/],
    ['aud:truehd', /\btruehd\b/],
    ['aud:flac', /\bflac\b/],
    ['aud:opus', /\bopus\b/],
    ['hdr:hdr', /\bhdr(?:10)?\+?/],
    ['hdr:dv', /\bdolby[-. ]?vision\b|\bdovi\b|\bdv\b/],
    ['lang:chinese', /\bchinese\b|\bmandarin\b/],
    ['lang:french', /\bfrench\b/],
    ['lang:vostfr', /\bvostfr\b/],
    ['lang:italian', /\bitalian\b|\bita\b/],
    ['lang:german', /\bgerman\b/],
    ['lang:spanish', /\bspanish\b|\bcastellano\b/],
    ['lang:latino', /\blatino\b/],
    ['lang:hindi', /\bhindi\b/],
    ['lang:korean', /\bkorean\b/],
    ['lang:japanese', /\bjapanese\b/],
    ['lang:russian', /\brussian\b|\brus\b/],
    ['lang:multi', /\bmulti\b/],
    ['lang:dual', /\bdual\b/],
    ['lang:dubbed', /\bdubbed\b/],
    ['lang:subbed', /\bsubbed\b/],
];

export function extractTraits(title: string): Set<string> {
    const t = title.toLowerCase();
    const traits = new Set<string>();

    for (const [trait, pattern] of TRAIT_PATTERNS) {
        if (pattern.test(t)) traits.add(trait);
    }

    const leadingGroup = t.match(/^\[([^\]]+)\]/);
    if (leadingGroup) traits.add(`grp:${leadingGroup[1].trim()}`);

    const stripped = t
        .replace(/\.\w{2,4}$/, '')
        .replace(/(\s*[\[(][^\])]*[\])])+\s*$/, '')
        .trimEnd();
    const trailingGroup = stripped.match(/-([a-z0-9]*[a-z][a-z0-9]*)$/);
    if (trailingGroup) traits.add(`grp:${trailingGroup[1]}`);

    return traits;
}

/**
 * Returns a scorer in [-1, 1]: per-trait vote balance summed over the
 * candidate's traits, normalized by its trait count so unknown traits
 * dilute toward 0 and the exact downvoted release scores near -1.
 */
export function buildAffinity(ups: string[], downs: string[]): (title: string) => number {
    const upCounts = new Map<string, number>();
    const downCounts = new Map<string, number>();
    for (const title of ups) {
        for (const trait of extractTraits(title)) upCounts.set(trait, (upCounts.get(trait) ?? 0) + 1);
    }
    for (const title of downs) {
        for (const trait of extractTraits(title)) downCounts.set(trait, (downCounts.get(trait) ?? 0) + 1);
    }

    return (title) => {
        const traits = extractTraits(title);
        let sum = 0;
        for (const trait of traits) {
            const up = upCounts.get(trait) ?? 0;
            const down = downCounts.get(trait) ?? 0;
            if (up + down > 0) sum += (up - down) / (up + down);
        }
        return sum / Math.max(1, traits.size);
    };
}
