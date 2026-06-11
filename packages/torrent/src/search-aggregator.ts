import { log } from '@fonte/core';
import { searchJackett, JackettResult } from './jackett-client';
import { searchBt4g } from './bt4g-client';

export interface AggregatedResult extends JackettResult {
    source: string;
    sizeStr?: string;
}

export interface AggregateSearchOpts {
    categories?: number[];
    jackettUrl?: string;
    apiKey?: string;
    // 'warn' (default) logs and continues with remaining sources; 'throw'
    // propagates Jackett failures so callers can treat the search as failed
    // rather than silently degrading to bt4g-only results.
    jackettErrors?: 'warn' | 'throw';
}

/**
 * Search Jackett (if configured) and bt4g for each query, dedupe by info
 * hash across all results, and tag each result with its source.
 */
export async function aggregateSearch(queries: string[], opts: AggregateSearchOpts = {}): Promise<AggregatedResult[]> {
    const { categories = [], jackettUrl, apiKey } = opts;
    const seenHashes = new Set<string>();
    const all: AggregatedResult[] = [];

    for (const query of new Set(queries.filter(q => q))) {
        if (jackettUrl && apiKey) {
            try {
                const results = await searchJackett({ query, categories, jackettUrl, apiKey });
                for (const r of results) {
                    const hash = extractInfoHash(r.magnetUri);
                    if (hash && seenHashes.has(hash)) continue;
                    if (hash) seenHashes.add(hash);
                    all.push({ ...r, source: r.indexer || 'jackett' });
                }
            } catch (err) {
                if (opts.jackettErrors === 'throw') throw err;
                log('WARN', `[search] Jackett failed for "${query}": ${(err as Error).message}`);
            }
        }

        try {
            const bt4gResults = await searchBt4g(query);
            for (const r of bt4gResults) {
                if (!r.magnetUri) continue;
                const cat = r.category?.toLowerCase();
                if (cat === 'doc' || cat === 'audio') continue;
                const hash = extractInfoHash(r.magnetUri) || r.infoHash?.toLowerCase();
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
        } catch (err) {
            log('WARN', `[search] bt4g failed for "${query}": ${(err as Error).message}`);
        }
    }

    return all;
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
        if (opts.seasonPattern && !rt.toUpperCase().includes(opts.seasonPattern.toUpperCase())) return false;
        return true;
    });
}

export function sortBySeedersThenSize<T extends { seeders?: number; size?: number }>(results: T[]): T[] {
    return [...results].sort((a, b) =>
        ((b.seeders || 0) - (a.seeders || 0)) || ((b.size || 0) - (a.size || 0)));
}

// ── Quality Ranking ───────────────────────────────────────────────────────────

export function rankResults<T extends { title: string; seeders: number; publishDate?: number }>(
    results: T[], preferredQuality: string): T[] {
    return [...results].sort((a, b) => {
        const scoreA = computeScore(a, preferredQuality);
        const scoreB = computeScore(b, preferredQuality);
        return scoreB - scoreA;
    });
}

export function computeScore(r: { title: string; seeders: number; publishDate?: number }, preferredQuality: string): number {
    const qm = computeQualityMatch(r.title, preferredQuality);
    const seederScore = Math.min(r.seeders, 100) / 100;
    const recencyScore = r.publishDate
        ? Math.max(0, 1 - (Date.now() - r.publishDate) / (7 * 24 * 60 * 60 * 1000))
        : 0;
    return (qm * 0.6) + (seederScore * 0.3) + (recencyScore * 0.1);
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

/** Extract a lowercase info hash from a magnet URI (hex or base32 form). */
export function extractInfoHash(magnetUri: string): string | undefined {
    const match = magnetUri.match(/xt=urn:btih:([a-fA-F0-9]{40})/);
    if (match) return match[1].toLowerCase();
    const b32 = magnetUri.match(/xt=urn:btih:([A-Z2-7]{32})/i);
    if (b32) return b32[1].toLowerCase();
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
