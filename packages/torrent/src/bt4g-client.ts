import { log } from '@fonte/core';

export interface Bt4gResult {
    title: string;
    magnetUri: string;
    size: string;
    category: string;
    infoHash: string;
    publishDate?: number;
}

export async function searchBt4g(query: string): Promise<Bt4gResult[]> {
    const url = `https://bt4gprx.com/search?q=${encodeURIComponent(query)}&page=rss`;

    const res = await fetch(url, {
        headers: { 'User-Agent': 'Fonte/1.0' },
        signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
        throw new Error(`bt4g search failed (${res.status})`);
    }

    const xml = await res.text();
    return parseRss(xml);
}

function parseRss(xml: string): Bt4gResult[] {
    const results: Bt4gResult[] = [];
    const items = xml.split('<item>').slice(1);

    for (const item of items) {
        const title = extractTag(item, 'title');
        const magnetUri = extractTag(item, 'link');
        const description = extractCdata(item, 'description');
        const pubDate = extractTag(item, 'pubDate');

        if (!title || !magnetUri) continue;

        // Parse description: "Title<br>Size<br>Category<br>InfoHash"
        const parts = description.split('<br>');
        const size = parts[1] || '';
        const category = parts[2] || '';
        const infoHash = parts[3] || '';

        results.push({
            title,
            magnetUri,
            size,
            category,
            infoHash,
            publishDate: pubDate ? new Date(pubDate).getTime() : undefined,
        });
    }

    return results;
}

function extractTag(xml: string, tag: string): string {
    // For <link>, content is between </title> and <guid> (not wrapped in tags for RSS)
    if (tag === 'link') {
        const match = xml.match(/<link>(.*?)<\/link>/s);
        if (match) return match[1].trim();
        // Fallback: magnet link after </title>
        const magnetMatch = xml.match(/<\/title>\s*(magnet:[^<]+)/s);
        if (magnetMatch) return magnetMatch[1].trim().replace(/&amp;/g, '&');
        return '';
    }
    const match = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
    return match ? match[1].trim() : '';
}

function extractCdata(xml: string, tag: string): string {
    const match = xml.match(new RegExp(`<${tag}><!\\[CDATA\\[(.+?)\\]\\]></${tag}>`, 's'));
    return match ? match[1].trim() : '';
}
