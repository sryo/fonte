import { log, getSettings } from '@fonte/core';
import { searchJackett, JackettResult, JackettSearch } from './jackett-client';
import { searchBt4g, Bt4gResult } from './bt4g-client';

export interface AggregatedResult extends JackettResult {
    source: string;
    sizeStr?: string;
}

export interface AggregateSearchOpts {
    categories?: number[];
    jackettUrl?: string;
    apiKey?: string;
}

export interface SourceOutcome {
    source: string;
    ok: boolean;
    error?: string;
    results: number;
}

export interface SearchReport {
    results: AggregatedResult[];
    sources: SourceOutcome[];
    failed: SourceOutcome[];
    /** Every source that was asked failed, so the search says nothing about availability. */
    allFailed: boolean;
}

function mergeOutcome(into: Map<string, SourceOutcome>, outcome: SourceOutcome): void {
    const prior = into.get(outcome.source);
    if (!prior) {
        into.set(outcome.source, { ...outcome });
        return;
    }
    prior.results += outcome.results;
    if (outcome.ok && !prior.ok) {
        prior.ok = true;
        delete prior.error;
    } else if (!outcome.ok && !prior.ok && !prior.error && outcome.error) {
        prior.error = outcome.error;
    }
}

/**
 * Search Jackett (if configured) and bt4g for each query, dedupe by info
 * hash across all results, tag each result with its source, and report which
 * sources answered.
 */
export async function aggregateSearchReport(queries: string[], opts: AggregateSearchOpts = {}): Promise<SearchReport> {
    const { categories = [], jackettUrl, apiKey } = opts;

    // All query variations hit both sources concurrently; the merge below runs
    // in query order so dedup priority (earlier variation, Jackett first) is
    // deterministic regardless of arrival order.
    const fetches = [...new Set(queries.filter(q => q))].map(async (query) => {
        const jackettPromise: Promise<JackettSearch | Error> = (jackettUrl && apiKey)
            ? searchJackett({ query, categories, jackettUrl, apiKey }).catch((err: Error) => err)
            : Promise.resolve({ results: [], sources: [] });
        const bt4gPromise: Promise<Bt4gResult[] | Error> = searchBt4g(query).catch((err: Error) => err);
        return { query, jackett: await jackettPromise, bt4g: await bt4gPromise };
    });

    const seenHashes = new Set<string>();
    const all: AggregatedResult[] = [];
    const outcomes = new Map<string, SourceOutcome>();
    // bt4g tags releases with its own coarse categories; dropping doc and
    // audio only makes sense when the search itself is video-scoped.
    const videoScoped = categories.some(c => (c >= 2000 && c < 3000) || (c >= 5000 && c < 6000));

    for (const { query, jackett, bt4g } of await Promise.all(fetches)) {
        if (jackett instanceof Error) {
            log('WARN', `[search] Jackett failed for "${query}": ${jackett.message}`);
            mergeOutcome(outcomes, { source: 'jackett', ok: false, error: jackett.message, results: 0 });
        } else {
            for (const outcome of jackett.sources) {
                mergeOutcome(outcomes, { source: outcome.indexer, ok: outcome.ok, error: outcome.error, results: outcome.results });
            }
            for (const r of jackett.results) {
                const hash = extractInfoHash(r.magnetUri);
                if (hash && seenHashes.has(hash)) continue;
                if (hash) seenHashes.add(hash);
                all.push({ ...r, source: r.indexer || 'jackett' });
            }
        }

        if (bt4g instanceof Error) {
            log('WARN', `[search] bt4g failed for "${query}": ${bt4g.message}`);
            mergeOutcome(outcomes, { source: 'bt4g', ok: false, error: bt4g.message, results: 0 });
            continue;
        }
        mergeOutcome(outcomes, { source: 'bt4g', ok: true, results: bt4g.length });
        for (const r of bt4g) {
            if (!r.magnetUri) continue;
            const cat = r.category?.toLowerCase();
            if (videoScoped && (cat === 'doc' || cat === 'audio')) continue;
            const hash = extractInfoHash(r.magnetUri) || (r.infoHash ? normalizeInfoHash(r.infoHash) : undefined);
            if (hash && seenHashes.has(hash)) continue;
            if (hash) seenHashes.add(hash);
            all.push({
                title: r.title,
                magnetUri: r.magnetUri,
                seeders: 0, // bt4g RSS doesn't include seeder count
                leechers: 0,
                size: parseSizeString(r.size),
                sizeStr: r.size,
                publishDate: r.publishDate,
                indexer: 'bt4g-dht',
                category: [],
                source: 'bt4g-dht',
            });
        }
    }

    const sources = [...outcomes.values()];
    const failed = sources.filter(s => !s.ok);
    return { results: all, sources, failed, allFailed: sources.length > 0 && failed.length === sources.length };
}

export async function aggregateSearch(queries: string[], opts: AggregateSearchOpts = {}): Promise<AggregatedResult[]> {
    return (await aggregateSearchReport(queries, opts)).results;
}

/** "eztv: Challenge detected, 1337x: timed out, bt4g: 503" for logs and the entry's last error. */
export function describeSearchFailure(report: Pick<SearchReport, 'failed'>): string {
    return report.failed.map(s => `${s.source}: ${s.error ?? 'failed'}`).join(', ').slice(0, 300);
}

export interface SearchReleasesOpts {
    title: string;
    year?: number;
    quality?: string;
    category?: number;
    season?: number;
    seasonPattern?: string;
}

/**
 * Search all sources for a known release: build query variations from
 * title/year/quality, aggregate, filter to matching titles, and sort by health.
 * Reads Jackett config from settings. Shared by the watchlist runner and the
 * "find alternatives" flow.
 */
export async function searchReleasesReport(opts: SearchReleasesOpts): Promise<SearchReport> {
    const { title, year, quality, category, season } = opts;
    const seasonPattern = opts.seasonPattern
        ?? (season != null ? `S${String(season).padStart(2, '0')}` : undefined);
    const settings = getSettings();
    const jackettUrl = settings.watchlist?.jackett_url;
    const apiKey = settings.watchlist?.jackett_api_key;

    const queries = new Set<string>();
    if (season != null) {
        queries.add(`${title} ${seasonPattern} ${quality || ''}`.trim());
        queries.add(`${title} ${seasonPattern}`);
        queries.add(`${title} Season ${season}`);
    }
    queries.add(`${title} ${year || ''} ${quality || ''}`.trim());
    queries.add(`${title} ${year || ''}`.trim());
    queries.add(title);

    const report = await aggregateSearchReport([...queries], {
        categories: category ? [category] : [],
        jackettUrl,
        apiKey,
    });

    const filtered = filterByTitle(report.results, { title, year, seasonPattern });
    return { ...report, results: sortBySeedersThenSize(filtered) };
}

export async function searchReleases(opts: SearchReleasesOpts): Promise<AggregatedResult[]> {
    return (await searchReleasesReport(opts)).results;
}

export interface TitleFilterOpts {
    title: string;
    year?: number;
    seasonPattern?: string;
}

/**
 * Keep only results whose title contains every word of the wanted title,
 * plus the year and season pattern when specified.
 */
export function filterByTitle<T extends { title: string }>(results: T[], opts: TitleFilterOpts): T[] {
    const titleWords = opts.title.toLowerCase().split(/\s+/);
    return results.filter(r => {
        const rt = r.title.toLowerCase();
        if (!titleWords.every(w => rt.includes(w))) return false;
        if (opts.year && !rt.includes(String(opts.year))) return false;
        if (opts.seasonPattern && !matchesSeasonPattern(rt, opts.seasonPattern)) return false;
        return true;
    });
}

// A season-only pattern ("S05") should also match releases named the long way
// ("Season 5 - Subtitle"); episode patterns ("S05E03") stay exact.
function matchesSeasonPattern(lowerTitle: string, pattern: string): boolean {
    if (lowerTitle.includes(pattern.toLowerCase())) return true;
    const seasonOnly = pattern.match(/^s(\d{1,2})$/i);
    if (!seasonOnly) return false;
    const n = parseInt(seasonOnly[1], 10);
    return new RegExp(`season\\s*0?${n}(?:\\D|$)`).test(lowerTitle);
}

export function sortBySeedersThenSize<T extends { seeders?: number; size?: number }>(results: T[]): T[] {
    return [...results].sort((a, b) =>
        ((b.seeders || 0) - (a.seeders || 0)) || ((b.size || 0) - (a.size || 0)));
}

// ── Quality Ranking ───────────────────────────────────────────────────────────

export function rankResults<T extends { title: string; seeders: number; publishDate?: number; size?: number }>(
    results: T[], preferredQuality: string, affinity?: (title: string) => number): T[] {
    return [...results].sort((a, b) => {
        const scoreA = computeScore(a, preferredQuality, affinity);
        const scoreB = computeScore(b, preferredQuality, affinity);
        return (scoreB - scoreA)
            || (b.seeders - a.seeders)
            || ((b.size || 0) - (a.size || 0));
    });
}

// The 0.25 affinity coefficient keeps a one-sided taste signal (±0.25)
// below the 0.3 quality gap between exact and adjacent tiers: a liked
// wrong-tier release never beats a neutral right-tier one. Only when the
// right-tier candidate is itself fully disliked can taste flip the tiers.
export function computeScore(r: { title: string; seeders: number; publishDate?: number }, preferredQuality: string, affinity?: (title: string) => number): number {
    const qm = computeQualityMatch(r.title, preferredQuality);
    const seederScore = Math.min(r.seeders, 100) / 100;
    const recencyScore = r.publishDate
        ? Math.max(0, 1 - (Date.now() - r.publishDate) / (7 * 24 * 60 * 60 * 1000))
        : 0;
    return (qm * 0.6) + (seederScore * 0.3) + (recencyScore * 0.1) + ((affinity?.(r.title) ?? 0) * 0.25);
}

export function computeQualityMatch(title: string, preferred: string): number {
    const t = title.toLowerCase();
    const p = preferred.toLowerCase();

    if (t.includes(p)) return 1.0;

    const adjacent: Record<string, string[]> = {
        '1080p': ['720p', '2160p', '4k'],
        '720p': ['1080p', '480p'],
        '4k': ['2160p', '1080p'],
        '2160p': ['4k', '1080p'],
    };

    const adj = adjacent[p] || [];
    for (const a of adj) {
        if (t.includes(a)) return 0.5;
    }

    return 0.1;
}

// ── Parsing helpers ───────────────────────────────────────────────────────────

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Decode a 32-char RFC 4648 base32 string to 40-char lowercase hex. */
function base32ToHex(b32: string): string | undefined {
    let bits = 0;
    let value = 0;
    let hex = '';
    for (const char of b32.toUpperCase()) {
        const index = BASE32_ALPHABET.indexOf(char);
        if (index === -1) return undefined;
        value = (value << 5) | index;
        bits += 5;
        if (bits >= 8) {
            bits -= 8;
            hex += ((value >> bits) & 0xff).toString(16).padStart(2, '0');
        }
    }
    return hex;
}

/**
 * Normalize a raw info hash to 40-char lowercase hex, decoding the base32
 * form so both encodings of one hash dedup to the same key.
 */
export function normalizeInfoHash(hash: string): string | undefined {
    if (/^[a-fA-F0-9]{40}$/.test(hash)) return hash.toLowerCase();
    if (/^[A-Za-z2-7]{32}$/.test(hash)) return base32ToHex(hash);
    return undefined;
}

/** Extract a normalized (40-char lowercase hex) info hash from a magnet URI. */
export function extractInfoHash(magnetUri: string): string | undefined {
    const match = magnetUri.match(/xt=urn:btih:([a-fA-F0-9]{40})/);
    if (match) return match[1].toLowerCase();
    const b32 = magnetUri.match(/xt=urn:btih:([A-Z2-7]{32})/i);
    if (b32) return base32ToHex(b32[1]);
    return undefined;
}

/** Parse a human-readable size like "1.4 GB" into bytes. */
export function parseSizeString(size: string): number {
    if (!size) return 0;
    const match = size.match(/([\d.]+)\s*(GB|MB|KB|TB)/i);
    if (!match) return 0;
    const value = parseFloat(match[1]);
    const unit = match[2].toUpperCase();
    const multipliers: Record<string, number> = { KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };
    return Math.round(value * (multipliers[unit] || 0));
}
