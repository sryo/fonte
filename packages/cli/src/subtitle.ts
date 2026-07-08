#!/usr/bin/env node
import * as p from '@clack/prompts';
import { apiRequest, padRight } from './shared.ts';

// ── Formatting helpers ────────────────────────────────────────────────────────

function statusColor(status: string): string {
    const colors: Record<string, string> = {
        pending: '\x1b[34m',       // blue
        downloading: '\x1b[36m',   // cyan
        downloaded: '\x1b[32m',    // green
        translating: '\x1b[33m',   // yellow
        translated: '\x1b[32m',    // green
        error: '\x1b[31m',         // red
    };
    return `${colors[status] || ''}${status}\x1b[0m`;
}

// ── Commands ──────────────────────────────────────────────────────────────────

async function subtitleFetch(torrentId: string) {
    console.log(`Fetching subtitles for torrent ${torrentId}...`);
    const result = await apiRequest('POST', `/api/torrents/${torrentId}/subtitles/fetch`);
    if (result.ok) {
        const subs = result.subtitles || [];
        if (subs.length === 0) {
            console.log('No subtitles found.');
        } else {
            console.log(`Found ${subs.length} subtitle(s):`);
            for (const s of subs) {
                console.log(`  [${s.id}] ${s.language} (${s.status}) ${s.filePath}`);
            }
        }
    } else {
        p.log.error(result.error || 'Failed to fetch subtitles');
        process.exit(1);
    }
}

async function subtitleList(torrentId: string) {
    const result = await apiRequest('GET', `/api/torrents/${torrentId}/subtitles`);
    if (!result.ok) {
        p.log.error(result.error || 'Failed to list subtitles');
        process.exit(1);
    }

    const subs = result.subtitles || [];
    if (subs.length === 0) {
        console.log('No subtitles.');
        return;
    }

    console.log(
        padRight('ID', 6) +
        padRight('Language', 12) +
        padRight('Original', 10) +
        padRight('Status', 14) +
        'File'
    );
    console.log('-'.repeat(80));

    for (const s of subs) {
        console.log(
            padRight(String(s.id), 6) +
            padRight(s.language, 12) +
            padRight(s.isOriginal ? 'yes' : 'no', 10) +
            padRight(statusColor(s.status), 14 + 9) + // extra for ANSI codes
            (s.filePath || '')
        );
    }
}

async function subtitleTranslate(subtitleId: string, lang: string) {
    console.log(`Translating subtitle ${subtitleId} to ${lang}...`);
    const result = await apiRequest('POST', `/api/subtitles/${subtitleId}/translate`, {
        language: lang,
    });
    if (result.ok) {
        console.log(result.message || `Translation to ${lang} started.`);
    } else {
        p.log.error(result.error || 'Failed to translate subtitle');
        process.exit(1);
    }
}

// ── CLI dispatch ──────────────────────────────────────────────────────────────

const command = process.argv[2];
const arg1 = process.argv[3];
const arg2 = process.argv[4];

(async () => {
    try {
        switch (command) {
            case 'fetch':
                if (!arg1) {
                    p.log.error('Usage: fonte subtitle fetch <torrent_id>');
                    process.exit(1);
                }
                await subtitleFetch(arg1);
                break;
            case 'list': case 'ls':
                if (!arg1) {
                    p.log.error('Usage: fonte subtitle list <torrent_id>');
                    process.exit(1);
                }
                await subtitleList(arg1);
                break;
            case 'translate':
                if (!arg1 || !arg2) {
                    p.log.error('Usage: fonte subtitle translate <subtitle_id> <lang>');
                    process.exit(1);
                }
                await subtitleTranslate(arg1, arg2);
                break;
            default:
                console.log('Usage: fonte subtitle {fetch|list|translate}');
                process.exit(1);
        }
    } catch (err) {
        p.log.error((err as Error).message);
        process.exit(1);
    }
})();
