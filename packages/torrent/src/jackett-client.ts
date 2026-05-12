import { log } from '@aitorrent/core';

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

export async function searchJackett(opts: JackettSearchOpts): Promise<JackettResult[]> {
    const { query, categories = [], jackettUrl, apiKey } = opts;

    const url = new URL('/api/v2.0/indexers/all/results', jackettUrl);
    url.searchParams.set('apikey', apiKey);
    url.searchParams.set('Query', query);
    for (const cat of categories) {
        url.searchParams.append('Category[]', String(cat));
    }

    const res = await fetch(url.toString(), {
        signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(`Jackett search failed (${res.status}): ${text}`);
    }

    const data = await res.json() as { Results?: any[] };
    const results = data.Results || [];

    return results.map((r: any) => ({
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
