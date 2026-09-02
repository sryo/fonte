import { log } from '@fonte/core';

export interface JackettResult {
    title: string;
    magnetUri: string;
    seeders: number;
    leechers: number;
    size: number;
    publishDate?: number;
    indexer: string;
    category: number[];
}

export interface JackettSearchOpts {
    query: string;
    categories?: number[];
    jackettUrl: string;
    apiKey: string;
}

export interface JackettSourceOutcome {
    indexer: string;
    ok: boolean;
    error?: string;
    results: number;
    elapsedMs: number;
}

export interface JackettSearch {
    results: JackettResult[];
    sources: JackettSourceOutcome[];
}

export interface JackettIndexer {
    id: string;
    name: string;
}

export const JACKETT_INDEXER_TIMEOUT_MS = 20_000;
const JACKETT_AGGREGATE_TIMEOUT_MS = 60_000;
const JACKETT_LIST_TIMEOUT_MS = 10_000;
const INDEXER_LIST_TTL_MS = 10 * 60 * 1000;

let indexerCache: { key: string; indexers: JackettIndexer[]; fetchedAt: number } | null = null;

export function resetJackettIndexerCache(): void {
    indexerCache = null;
}

/**
 * The configured indexers, from the torznab listing (the admin list needs a
 * session cookie). Cached, since the runner asks on every check.
 */
export async function listJackettIndexers(jackettUrl: string, apiKey: string): Promise<JackettIndexer[]> {
    const key = `${jackettUrl}|${apiKey}`;
    if (indexerCache?.key === key && Date.now() - indexerCache.fetchedAt < INDEXER_LIST_TTL_MS) {
        return indexerCache.indexers;
    }
    const url = new URL('/api/v2.0/indexers/all/results/torznab/api', jackettUrl);
    url.searchParams.set('apikey', apiKey);
    url.searchParams.set('t', 'indexers');
    url.searchParams.set('configured', 'true');
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(JACKETT_LIST_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Jackett indexer list failed (${res.status})`);
    const xml = await res.text();
    const indexers: JackettIndexer[] = [];
    for (const match of xml.matchAll(/<indexer\s+id="([^"]+)"[^>]*>\s*<title>([^<]*)<\/title>/g)) {
        indexers.push({ id: match[1], name: decodeXml(match[2]) || match[1] });
    }
    indexerCache = { key, indexers, fetchedAt: Date.now() };
    return indexers;
}

function decodeXml(text: string): string {
    return text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim();
}

function resultsUrl(jackettUrl: string, apiKey: string, path: string, query: string, categories: number[]): string {
    const url = new URL(path, jackettUrl);
    url.searchParams.set('apikey', apiKey);
    url.searchParams.set('Query', query);
    for (const cat of categories) url.searchParams.append('Category[]', String(cat));
    return url.toString();
}

function mapResults(raw: any[]): JackettResult[] {
    return raw.map((r: any) => ({
        title: r.Title || '',
        magnetUri: r.MagnetUri || r.Link || '',
        seeders: r.Seeders ?? 0,
        leechers: r.Peers ?? 0,
        size: r.Size ?? 0,
        publishDate: r.PublishDate ? new Date(r.PublishDate).getTime() : undefined,
        indexer: r.Tracker || r.TrackerId || 'unknown',
        category: r.Category || [],
    })).filter((r: JackettResult) => r.magnetUri);
}

function describeFetchError(err: unknown): string {
    const message = (err as Error)?.message ?? String(err);
    return /aborted|timeout/i.test(message) ? 'timed out' : message;
}

async function fetchResults(url: string, timeoutMs: number): Promise<{ raw: any[]; indexers: any[] }> {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(`Jackett search failed (${res.status}): ${text}`);
    }
    const data = await res.json() as { Results?: any[]; Indexers?: any[] };
    return { raw: data.Results || [], indexers: data.Indexers || [] };
}

async function searchOneIndexer(indexer: JackettIndexer, opts: JackettSearchOpts): Promise<{ results: JackettResult[]; outcome: JackettSourceOutcome }> {
    const started = Date.now();
    const url = resultsUrl(opts.jackettUrl, opts.apiKey, `/api/v2.0/indexers/${encodeURIComponent(indexer.id)}/results`, opts.query, opts.categories ?? []);
    try {
        const { raw, indexers } = await fetchResults(url, JACKETT_INDEXER_TIMEOUT_MS);
        // A reachable indexer that failed upstream (Cloudflare challenge, dead
        // site) still answers 200 with its error in the Indexers block.
        const reported = indexers.find((i: any) => i.ID === indexer.id || i.Name === indexer.name);
        const error = reported?.Error ? String(reported.Error).replace(/^Jackett\.Common\.IndexerException: /, '').replace(/^Exception \([^)]*\): /, '') : undefined;
        const results = mapResults(raw);
        return {
            results,
            outcome: { indexer: indexer.name, ok: !error, ...(error ? { error: error.slice(0, 160) } : {}), results: results.length, elapsedMs: Date.now() - started },
        };
    } catch (err) {
        return {
            results: [],
            outcome: { indexer: indexer.name, ok: false, error: describeFetchError(err), results: 0, elapsedMs: Date.now() - started },
        };
    }
}

/**
 * Query every configured indexer separately and in parallel, each on its own
 * timeout, so one blocked site cannot sink the rest. Falls back to Jackett's
 * aggregate endpoint when the indexer list itself is unavailable.
 */
export async function searchJackett(opts: JackettSearchOpts): Promise<JackettSearch> {
    let indexers: JackettIndexer[] = [];
    try {
        indexers = await listJackettIndexers(opts.jackettUrl, opts.apiKey);
    } catch (err) {
        log('WARN', `[jackett] indexer list unavailable, using the aggregate search: ${describeFetchError(err)}`);
    }

    if (indexers.length === 0) {
        const started = Date.now();
        const url = resultsUrl(opts.jackettUrl, opts.apiKey, '/api/v2.0/indexers/all/results', opts.query, opts.categories ?? []);
        const { raw } = await fetchResults(url, JACKETT_AGGREGATE_TIMEOUT_MS);
        const results = mapResults(raw);
        return { results, sources: [{ indexer: 'jackett', ok: true, results: results.length, elapsedMs: Date.now() - started }] };
    }

    const settled = await Promise.all(indexers.map(indexer => searchOneIndexer(indexer, opts)));
    return {
        results: settled.flatMap(s => s.results),
        sources: settled.map(s => s.outcome),
    };
}
