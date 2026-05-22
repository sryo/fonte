import fs from 'fs';
import path from 'path';

const API_BASE = 'https://api.opensubtitles.com/api/v1';
const DEFAULT_USER_AGENT = 'Fonte v0.1.0';

export interface OpenSubtitlesResult {
    name: string;
    language: string;
    fileId: number;
    format: string;
}

function authHeaders(apiKey: string, userAgent?: string): Record<string, string> {
    return {
        'Api-Key': apiKey,
        'User-Agent': userAgent || DEFAULT_USER_AGENT,
        'Accept': 'application/json',
    };
}

export async function searchOpenSubtitles(opts: {
    query: string;
    languages?: string[];
    year?: number;
    apiKey: string;
    userAgent?: string;
}): Promise<OpenSubtitlesResult[]> {
    const { query, languages = [], year, apiKey, userAgent } = opts;

    const url = new URL(`${API_BASE}/subtitles`);
    url.searchParams.set('query', query);
    if (languages.length > 0) url.searchParams.set('languages', languages.join(','));
    if (year) url.searchParams.set('year', String(year));

    const res = await fetch(url.toString(), {
        headers: authHeaders(apiKey, userAgent),
        signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
        throw new Error(`OpenSubtitles search failed (${res.status})`);
    }

    const data = await res.json() as { data?: any[] };
    const items = data.data || [];

    return items.map((item: any) => {
        const attrs = item.attributes || {};
        const files = attrs.files || [];
        const fileId = files[0]?.file_id;
        return {
            name: attrs.release || attrs.feature_details?.title || '',
            language: attrs.language || '',
            fileId,
            format: 'srt',
        };
    }).filter((r: OpenSubtitlesResult) => r.fileId);
}

export async function downloadOpenSubtitle(opts: {
    fileId: number;
    destPath: string;
    apiKey: string;
    userAgent?: string;
}): Promise<void> {
    const { fileId, destPath, apiKey, userAgent } = opts;

    // OpenSubtitles returns a temporary signed URL via a POST to /download
    // before the actual file can be fetched. This also counts against the
    // daily download quota (free tier: 5/day).
    const linkRes = await fetch(`${API_BASE}/download`, {
        method: 'POST',
        headers: {
            ...authHeaders(apiKey, userAgent),
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ file_id: fileId }),
        signal: AbortSignal.timeout(15000),
    });

    if (!linkRes.ok) {
        throw new Error(`OpenSubtitles download request failed (${linkRes.status})`);
    }

    const linkData = await linkRes.json() as { link?: string };
    if (!linkData.link) {
        throw new Error('OpenSubtitles: download response missing link');
    }

    const fileRes = await fetch(linkData.link, {
        signal: AbortSignal.timeout(30000),
    });

    if (!fileRes.ok) {
        throw new Error(`OpenSubtitles file fetch failed (${fileRes.status})`);
    }

    const buffer = Buffer.from(await fileRes.arrayBuffer());

    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(destPath, buffer);
}
