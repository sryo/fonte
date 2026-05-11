import { log } from '@aitorrent/core';

export interface BitmagnetResult {
    title: string;
    magnetUri: string;
    infoHash: string;
    seeders: number;
    leechers: number;
    size: number;
    publishDate?: number;
    category: string;
}

export interface BitmagnetSearchOpts {
    query: string;
    categories?: number[];     // Torznab categories: 2000=Movies, 5000=TV
    imdbId?: string;           // tt1234567
    tmdbId?: number;
    season?: number;
    episode?: number;
    baseUrl?: string;          // default: http://localhost:3333
}

/**
 * Search bitmagnet via its Torznab-compatible API.
 * Supports keyword search, IMDB ID, TMDB ID, season/episode filtering.
 */
export async function searchBitmagnet(opts: BitmagnetSearchOpts): Promise<BitmagnetResult[]> {
    const baseUrl = opts.baseUrl || 'http://localhost:3333';

    // Determine search type
    let searchType = 'search';
    if (opts.categories?.some(c => c >= 5000 && c < 6000)) {
        searchType = 'tvsearch';
    } else if (opts.categories?.some(c => c >= 2000 && c < 3000)) {
        searchType = 'movie';
    }

    const url = new URL('/torznab/', baseUrl);
    url.searchParams.set('t', searchType);

    if (opts.query) url.searchParams.set('q', opts.query);
    if (opts.imdbId) url.searchParams.set('imdbid', opts.imdbId);
    if (opts.tmdbId) url.searchParams.set('tmdbid', String(opts.tmdbId));
    if (opts.season) url.searchParams.set('season', String(opts.season));
    if (opts.episode) url.searchParams.set('ep', String(opts.episode));
    if (opts.categories?.length) {
        url.searchParams.set('cat', opts.categories.join(','));
    }
    url.searchParams.set('extended', '1');
    url.searchParams.set('limit', '100');

    const res = await fetch(url.toString(), {
        signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
        throw new Error(`bitmagnet search failed (${res.status})`);
    }

    const xml = await res.text();
    return parseTorznabResponse(xml);
}

/**
 * Check if bitmagnet is reachable.
 */
export async function isBitmagnetAvailable(baseUrl = 'http://localhost:3333'): Promise<boolean> {
    try {
        const res = await fetch(`${baseUrl}/status`, { signal: AbortSignal.timeout(3000) });
        return res.ok;
    } catch {
        return false;
    }
}

// ── Torznab XML Parser ────────────────────────────────────────────────────────

function parseTorznabResponse(xml: string): BitmagnetResult[] {
    const results: BitmagnetResult[] = [];
    const items = xml.split('<item>').slice(1);

    for (const item of items) {
        const title = extractXmlTag(item, 'title');
        if (!title) continue;

        // Get magnet/link
        let magnetUri = '';
        const linkMatch = item.match(/<link>(.*?)<\/link>/s);
        if (linkMatch) {
            magnetUri = linkMatch[1].trim();
        }
        // Fallback: check enclosure or torznab magneturl attribute
        if (!magnetUri || !magnetUri.startsWith('magnet:')) {
            const encMatch = item.match(/url="([^"]*magnet[^"]*)"/);
            if (encMatch) magnetUri = encMatch[1];
        }
        // Fallback: torznab:attr for magneturl
        const magnetAttr = item.match(/name="magneturl"\s+value="([^"]*)"/);
        if (magnetAttr) magnetUri = magnetAttr[1];

        if (!magnetUri) continue;
        magnetUri = magnetUri.replace(/&amp;/g, '&');

        // Extract info hash
        const hashMatch = magnetUri.match(/btih:([a-fA-F0-9]{40})/i);
        const infoHash = hashMatch ? hashMatch[1].toLowerCase() : '';

        // Get size from torznab:attr or enclosure
        let size = 0;
        const sizeAttr = item.match(/name="size"\s+value="(\d+)"/);
        if (sizeAttr) {
            size = parseInt(sizeAttr[1], 10);
        } else {
            const encSize = item.match(/length="(\d+)"/);
            if (encSize) size = parseInt(encSize[1], 10);
        }

        // Seeders/leechers
        const seedersAttr = item.match(/name="seeders"\s+value="(\d+)"/);
        const leechersAttr = item.match(/name="peers"\s+value="(\d+)"/);
        const seeders = seedersAttr ? parseInt(seedersAttr[1], 10) : 0;
        const leechers = leechersAttr ? parseInt(leechersAttr[1], 10) : 0;

        // Category
        const catAttr = item.match(/name="category"\s+value="(\d+)"/);
        const category = catAttr ? catAttr[1] : '';

        // Publish date
        const pubDate = extractXmlTag(item, 'pubDate');
        const publishDate = pubDate ? new Date(pubDate).getTime() : undefined;

        results.push({
            title,
            magnetUri,
            infoHash,
            seeders,
            leechers,
            size,
            publishDate,
            category,
        });
    }

    return results;
}

function extractXmlTag(xml: string, tag: string): string {
    // Handle CDATA
    const cdataMatch = xml.match(new RegExp(`<${tag}><!\\[CDATA\\[(.+?)\\]\\]></${tag}>`, 's'));
    if (cdataMatch) return cdataMatch[1].trim();
    // Plain text
    const match = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
    return match ? match[1].trim() : '';
}
