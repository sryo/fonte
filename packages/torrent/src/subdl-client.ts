import fs from 'fs';
import path from 'path';

export interface SubdlResult {
    name: string;
    language: string;
    downloadUrl: string;
    format: string;
}

export async function searchSubdl(opts: {
    filmName: string;
    languages?: string[];
    type?: string;
}): Promise<SubdlResult[]> {
    const { filmName, languages = [], type = 'srt' } = opts;

    const url = new URL('https://api.subdl.com/api/v1/subtitles');
    url.searchParams.set('film_name', filmName);
    if (languages.length > 0) url.searchParams.set('languages', languages.join(','));
    if (type) url.searchParams.set('type', type);

    const res = await fetch(url.toString(), {
        signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
        throw new Error(`Subdl search failed (${res.status})`);
    }

    const data = await res.json() as { subtitles?: any[]; status?: boolean };
    const subtitles = data.subtitles || [];

    return subtitles.map((s: any) => ({
        name: s.release_name || s.name || '',
        language: s.language || s.lang || '',
        downloadUrl: s.url || s.download_url || '',
        format: s.format || type,
    })).filter((s: SubdlResult) => s.downloadUrl);
}

export async function downloadSubtitle(downloadUrl: string, destPath: string): Promise<void> {
    const res = await fetch(downloadUrl, {
        signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
        throw new Error(`Subtitle download failed (${res.status})`);
    }

    const buffer = Buffer.from(await res.arrayBuffer());

    // Ensure directory exists
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(destPath, buffer);
}
