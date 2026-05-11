import fs from 'fs';
import path from 'path';
import { log, emitEvent, getSettings } from '@aitorrent/core';
import { getTorrent } from './torrent-db';
import { getTorrentFiles } from './torrent-db';
import { insertSubtitle, updateSubtitle, getSubtitle, getSubtitlesByTorrent } from './subtitle-db';
import { searchTmdb } from './tmdb-client';
import { searchSubdl, downloadSubtitle } from './subdl-client';
import { SUBTITLE_EVENTS } from './watchlist-events';

const VIDEO_EXTENSIONS = new Set(['.mkv', '.mp4', '.avi', '.m4v', '.mov', '.wmv', '.flv', '.webm']);

// ── Public API ────────────────────────────────────────────────────────────────

export async function handleTorrentCompleted(torrentId: string): Promise<void> {
    const settings = getSettings();
    if (!settings.subtitles?.enabled || !settings.subtitles?.auto_download) return;

    await fetchSubtitlesForTorrent(torrentId);
}

export async function fetchSubtitlesForTorrent(torrentId: string): Promise<void> {
    const torrent = getTorrent(torrentId);
    if (!torrent) throw new Error(`Torrent not found: ${torrentId}`);

    if (!torrent.name) {
        log('INFO', `Subtitles: torrent "${torrentId}" has no name yet, skipping`);
        return;
    }

    const settings = getSettings();
    const tmdbApiKey = settings.subtitles?.tmdb_api_key;
    const targetLanguages = settings.subtitles?.target_languages || ['en'];
    const shouldTranslate = settings.subtitles?.translate !== false;

    // Find video files
    const files = getTorrentFiles(torrentId);
    const videoFiles = files.filter(f => VIDEO_EXTENSIONS.has(path.extname(f.name).toLowerCase()));
    if (videoFiles.length === 0) {
        log('INFO', `Subtitles: no video files in torrent "${torrent.name}"`);
        return;
    }

    // Parse title/year from torrent name
    const parsed = parseTorrentName(torrent.name);
    log('INFO', `Subtitles: processing "${parsed.title}" (${parsed.year || 'unknown year'})`);

    // Detect original language via TMDB
    let originalLanguage = 'en';
    if (tmdbApiKey) {
        try {
            const info = await searchTmdb({
                title: parsed.title,
                year: parsed.year,
                mediaType: parsed.isTv ? 'tv' : 'movie',
                apiKey: tmdbApiKey,
            });
            if (info) {
                originalLanguage = info.originalLanguage;
                log('INFO', `Subtitles: detected original language "${originalLanguage}" for "${parsed.title}"`);
            }
        } catch (err) {
            log('WARN', `Subtitles: TMDB lookup failed: ${(err as Error).message}`);
        }
    }

    // Search for subtitles in original language
    const searchLangs = [originalLanguage];
    // Also search target languages if different
    for (const lang of targetLanguages) {
        if (!searchLangs.includes(lang)) searchLangs.push(lang);
    }

    try {
        const results = await searchSubdl({
            filmName: parsed.title,
            languages: searchLangs,
        });

        if (results.length === 0) {
            log('INFO', `Subtitles: no results found for "${parsed.title}"`);
            return;
        }

        // Download original language subtitle
        const originalSub = results.find(r => r.language.toLowerCase().startsWith(originalLanguage))
            || results[0];

        const mainVideoFile = videoFiles[0];
        const videoDir = path.dirname(path.join(torrent.savePath, mainVideoFile.path));
        const videoBase = path.basename(mainVideoFile.name, path.extname(mainVideoFile.name));
        const subPath = path.join(videoDir, `${videoBase}.${originalSub.language}.srt`);

        const subId = insertSubtitle({
            torrentId,
            filePath: subPath,
            language: originalSub.language,
            isOriginal: true,
        });
        updateSubtitle(subId, { status: 'downloading' });

        await downloadSubtitle(originalSub.downloadUrl, subPath);
        updateSubtitle(subId, { status: 'downloaded' });

        emitEvent(SUBTITLE_EVENTS.DOWNLOADED, {
            torrentId,
            subtitleId: subId,
            language: originalSub.language,
            filePath: subPath,
        });
        log('INFO', `Subtitles: downloaded ${originalSub.language} subs for "${parsed.title}"`);

        // Translate to target languages
        if (shouldTranslate) {
            for (const targetLang of targetLanguages) {
                if (targetLang === originalSub.language) continue;
                try {
                    await translateSubtitleFile(torrentId, subId, subPath, originalSub.language, targetLang, videoDir, videoBase);
                } catch (err) {
                    log('ERROR', `Subtitles: translation to ${targetLang} failed: ${(err as Error).message}`);
                }
            }
        }
    } catch (err) {
        log('ERROR', `Subtitles: fetch failed for "${parsed.title}": ${(err as Error).message}`);
    }
}

export async function translateSubtitle(subtitleId: number, targetLang: string): Promise<void> {
    const sub = getSubtitle(subtitleId);
    if (!sub) throw new Error(`Subtitle not found: ${subtitleId}`);

    const torrent = getTorrent(sub.torrentId);
    if (!torrent) throw new Error(`Torrent not found: ${sub.torrentId}`);

    const videoFiles = getTorrentFiles(sub.torrentId).filter(f => VIDEO_EXTENSIONS.has(path.extname(f.name).toLowerCase()));
    const mainVideo = videoFiles[0];
    const videoDir = path.dirname(path.join(torrent.savePath, mainVideo?.path || ''));
    const videoBase = mainVideo ? path.basename(mainVideo.name, path.extname(mainVideo.name)) : 'subtitle';

    await translateSubtitleFile(sub.torrentId, subtitleId, sub.filePath, sub.language, targetLang, videoDir, videoBase);
}

// ── SRT Parsing ───────────────────────────────────────────────────────────────

interface SrtBlock {
    index: number;
    timestamp: string;
    text: string;
}

function parseSrt(content: string): SrtBlock[] {
    const blocks: SrtBlock[] = [];
    const raw = content.replace(/\r\n/g, '\n').trim().split('\n\n');

    for (const block of raw) {
        const lines = block.split('\n');
        if (lines.length < 3) continue;

        const index = parseInt(lines[0], 10);
        if (isNaN(index)) continue;

        const timestamp = lines[1];
        const text = lines.slice(2).join('\n');

        blocks.push({ index, timestamp, text });
    }

    return blocks;
}

function assembleSrt(blocks: SrtBlock[]): string {
    return blocks.map(b => `${b.index}\n${b.timestamp}\n${b.text}`).join('\n\n') + '\n';
}

// ── AI Translation ────────────────────────────────────────────────────────────

async function translateSubtitleFile(
    torrentId: string,
    sourceSubId: number,
    sourcePath: string,
    sourceLang: string,
    targetLang: string,
    videoDir: string,
    videoBase: string,
): Promise<void> {
    const settings = getSettings();
    const apiKey = settings.models?.anthropic?.api_key;
    if (!apiKey) {
        log('WARN', 'Subtitles: no Anthropic API key configured, skipping translation');
        return;
    }

    const destPath = path.join(videoDir, `${videoBase}.${targetLang}.srt`);
    const transSubId = insertSubtitle({
        torrentId,
        filePath: destPath,
        language: targetLang,
        isOriginal: false,
        sourceSubtitleId: sourceSubId,
    });
    updateSubtitle(transSubId, { status: 'translating' });

    try {
        const content = fs.readFileSync(sourcePath, 'utf8');
        const blocks = parseSrt(content);

        if (blocks.length === 0) {
            updateSubtitle(transSubId, { status: 'error', errorMessage: 'No subtitle blocks found in source' });
            return;
        }

        // Translate in batches of 50 blocks
        const batchSize = 50;
        const translatedBlocks: SrtBlock[] = [];

        for (let i = 0; i < blocks.length; i += batchSize) {
            const batch = blocks.slice(i, i + batchSize);
            const textToTranslate = batch.map(b => b.text).join('\n---\n');

            const translated = await callAnthropicTranslate(apiKey, textToTranslate, sourceLang, targetLang);
            const translatedTexts = translated.split('\n---\n');

            for (let j = 0; j < batch.length; j++) {
                translatedBlocks.push({
                    index: batch[j].index,
                    timestamp: batch[j].timestamp,
                    text: translatedTexts[j]?.trim() || batch[j].text,
                });
            }
        }

        const translatedContent = assembleSrt(translatedBlocks);
        fs.writeFileSync(destPath, translatedContent, 'utf8');

        updateSubtitle(transSubId, { status: 'translated' });

        emitEvent(SUBTITLE_EVENTS.TRANSLATED, {
            torrentId,
            subtitleId: transSubId,
            sourceLanguage: sourceLang,
            targetLanguage: targetLang,
            filePath: destPath,
        });

        log('INFO', `Subtitles: translated ${sourceLang} → ${targetLang} (${translatedBlocks.length} blocks)`);
    } catch (err) {
        const msg = (err as Error).message;
        updateSubtitle(transSubId, { status: 'error', errorMessage: msg });
        emitEvent(SUBTITLE_EVENTS.ERROR, { torrentId, subtitleId: transSubId, error: msg });
        throw err;
    }
}

async function callAnthropicTranslate(apiKey: string, text: string, sourceLang: string, targetLang: string): Promise<string> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 4096,
            messages: [{
                role: 'user',
                content: `Translate the following subtitle text from ${sourceLang} to ${targetLang}. Keep the "---" separators between blocks exactly as they are. Only output the translated text, nothing else.\n\n${text}`,
            }],
        }),
        signal: AbortSignal.timeout(60000),
    });

    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Anthropic API error (${res.status}): ${body}`);
    }

    const data = await res.json() as { content?: { text?: string }[] };
    return data.content?.[0]?.text || text;
}

// ── Name Parsing ──────────────────────────────────────────────────────────────

function parseTorrentName(name: string): { title: string; year?: number; isTv: boolean } {
    // Remove common suffixes and quality markers
    let cleaned = name
        .replace(/\.(mkv|mp4|avi|m4v)$/i, '')
        .replace(/\./g, ' ')
        .replace(/_/g, ' ');

    // Detect TV show pattern (S01E01, etc.)
    const isTv = /S\d{2}E?\d{0,2}/i.test(cleaned);

    // Extract year
    const yearMatch = cleaned.match(/[\s.(](\d{4})[\s.)]/);
    const year = yearMatch ? parseInt(yearMatch[1], 10) : undefined;

    // Extract title (everything before year or quality tags)
    const cutoffs = ['1080p', '720p', '2160p', '4K', 'BluRay', 'WEBRip', 'WEB-DL', 'HDRip', 'BRRip', 'HDTV', 'x264', 'x265', 'HEVC', 'AAC', 'DTS'];
    let title = cleaned;

    if (year) {
        const yearIdx = title.indexOf(String(year));
        if (yearIdx > 0) title = title.substring(0, yearIdx);
    }

    for (const c of cutoffs) {
        const idx = title.toLowerCase().indexOf(c.toLowerCase());
        if (idx > 0) title = title.substring(0, idx);
    }

    // Clean TV pattern from title
    const tvMatch = title.match(/(.+?)\s*S\d{2}/i);
    if (tvMatch) title = tvMatch[1];

    return { title: title.trim(), year, isTv };
}
