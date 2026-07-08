#!/usr/bin/env node
import * as p from '@clack/prompts';
import { apiRequest, formatBytes, padRight } from './shared.ts';

// ── Formatting helpers ────────────────────────────────────────────────────────

function statusColor(status: string): string {
    const colors: Record<string, string> = {
        watching: '\x1b[36m',   // cyan
        fulfilled: '\x1b[32m',  // green
        paused: '\x1b[33m',     // yellow
    };
    return `${colors[status] || ''}${status}\x1b[0m`;
}

// ── Flag parsing ──────────────────────────────────────────────────────────────

function getFlag(name: string): string | undefined {
    const idx = process.argv.indexOf(`--${name}`);
    if (idx === -1) return undefined;
    return process.argv[idx + 1];
}

// ── Commands ──────────────────────────────────────────────────────────────────

async function watchlistAdd(title: string) {
    const mediaType = getFlag('type') || 'movie';
    const year = getFlag('year') ? parseInt(getFlag('year')!, 10) : undefined;
    const quality = getFlag('quality') || '1080p';
    const seasonPattern = getFlag('season');

    const result = await apiRequest('POST', '/api/watchlist', {
        title,
        mediaType,
        year,
        quality,
        seasonPattern,
    });

    if (result.ok) {
        const e = result.entry;
        console.log(`Added to watchlist: ${e.title}`);
        console.log(`  ID:       ${e.id}`);
        console.log(`  Type:     ${e.mediaType}`);
        console.log(`  Quality:  ${e.quality}`);
        console.log(`  Query:    ${e.searchQuery}`);
        if (e.year) console.log(`  Year:     ${e.year}`);
        if (e.seasonPattern) console.log(`  Season:   ${e.seasonPattern}`);
    } else {
        p.log.error(result.error || 'Failed to add watchlist entry');
        process.exit(1);
    }
}

async function watchlistList() {
    const result = await apiRequest('GET', '/api/watchlist');
    if (!result.ok) {
        p.log.error(result.error || 'Failed to list watchlist');
        process.exit(1);
    }

    const entries = result.entries;
    if (entries.length === 0) {
        console.log('No watchlist entries.');
        return;
    }

    console.log(
        padRight('ID', 14) +
        padRight('Title', 30) +
        padRight('Type', 8) +
        padRight('Quality', 10) +
        padRight('Year', 6) +
        padRight('Checked', 22) +
        'Status'
    );
    console.log('-'.repeat(96));

    for (const e of entries) {
        const title = (e.title || '').substring(0, 28);
        const checked = e.lastCheckedAt ? new Date(e.lastCheckedAt).toLocaleString() : 'never';
        console.log(
            padRight(e.id, 14) +
            padRight(title, 30) +
            padRight(e.mediaType, 8) +
            padRight(e.quality, 10) +
            padRight(e.year ? String(e.year) : '-', 6) +
            padRight(checked, 22) +
            statusColor(e.status)
        );
    }

    console.log('');
    console.log(`Total: ${entries.length} entries`);
}

async function watchlistRemove(id: string) {
    const result = await apiRequest('DELETE', `/api/watchlist/${id}`);
    if (result.ok) {
        console.log(`Removed watchlist entry: ${id}`);
    } else {
        p.log.error(result.error || 'Failed to remove watchlist entry');
        process.exit(1);
    }
}

async function watchlistCheck() {
    console.log('Triggering watchlist check...');
    const result = await apiRequest('POST', '/api/watchlist/check');
    if (result.ok) {
        console.log('Watchlist check completed.');
    } else {
        p.log.error(result.error || 'Watchlist check failed');
        process.exit(1);
    }
}

async function watchlistSearch(id: string) {
    console.log(`Searching for watchlist entry ${id}...`);
    const result = await apiRequest('POST', `/api/watchlist/${id}/search`);
    if (!result.ok) {
        p.log.error(result.error || 'Search failed');
        process.exit(1);
    }

    console.log(`Found ${result.resultCount} results:`);
    if (result.results && result.results.length > 0) {
        console.log('');
        console.log(
            padRight('#', 4) +
            padRight('Title', 50) +
            padRight('Size', 10) +
            padRight('Seeds', 7) +
            'Indexer'
        );
        console.log('-'.repeat(80));

        for (let i = 0; i < Math.min(result.results.length, 20); i++) {
            const r = result.results[i];
            console.log(
                padRight(String(i + 1), 4) +
                padRight((r.title || '').substring(0, 48), 50) +
                padRight(formatBytes(r.size || 0), 10) +
                padRight(String(r.seeders || 0), 7) +
                (r.indexer || '')
            );
        }
    }
}

// ── CLI dispatch ──────────────────────────────────────────────────────────────

const command = process.argv[2];
const arg1 = process.argv[3];

(async () => {
    try {
        switch (command) {
            case 'add':
                if (!arg1) {
                    p.log.error('Usage: fonte watchlist add <title> [--type movie|tv|music|game|book|app|other] [--year N] [--quality Q] [--season S03]');
                    process.exit(1);
                }
                await watchlistAdd(arg1);
                break;
            case 'list': case 'ls':
                await watchlistList();
                break;
            case 'remove': case 'rm':
                if (!arg1) {
                    p.log.error('Usage: fonte watchlist remove <id>');
                    process.exit(1);
                }
                await watchlistRemove(arg1);
                break;
            case 'check':
                await watchlistCheck();
                break;
            case 'search':
                if (!arg1) {
                    p.log.error('Usage: fonte watchlist search <id>');
                    process.exit(1);
                }
                await watchlistSearch(arg1);
                break;
            default:
                console.log('Usage: fonte watchlist {add|list|remove|check|search}');
                process.exit(1);
        }
    } catch (err) {
        p.log.error((err as Error).message);
        process.exit(1);
    }
})();
