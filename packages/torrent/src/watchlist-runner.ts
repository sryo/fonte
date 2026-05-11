import { Cron } from 'croner';
import { log, emitEvent, getSettings } from '@aitorrent/core';
import { searchBitmagnet, BitmagnetResult } from './bitmagnet-client';
import {
    getWatchlistEntries, updateWatchlistEntry,
    insertWatchlistResult, getWatchlistResults, markResultSelected,
} from './watchlist-db';
import { getTorrentManager } from './torrent-manager';
import { getTorrentByHash } from './torrent-db';
import { WATCHLIST_EVENTS } from './watchlist-events';

interface SearchResult {
    title: string;
    magnetUri: string;
    seeders: number;
    leechers: number;
    size: number;
    publishDate?: number;
    indexer: string;
    category: number[];
}

let watchlistJob: Cron | null = null;

export function startWatchlistRunner(intervalMinutes: number): void {
    if (watchlistJob) return;

    const cron = `*/${intervalMinutes} * * * *`;
    watchlistJob = new Cron(cron, () => {
        runWatchlistCheck().catch(err => {
            log('ERROR', `Watchlist check failed: ${err.message}`);
        });
    });

    log('INFO', `Watchlist runner started (every ${intervalMinutes} min)`);

    // Run once immediately on startup
    setTimeout(() => {
        runWatchlistCheck().catch(err => {
            log('ERROR', `Initial watchlist check failed: ${err.message}`);
        });
    }, 5000);
}

export function stopWatchlistRunner(): void {
    if (watchlistJob) {
        watchlistJob.stop();
        watchlistJob = null;
        log('INFO', 'Watchlist runner stopped');
    }
}

export async function runWatchlistCheck(): Promise<void> {
    const settings = getSettings();
    const bitmagnetUrl = settings.watchlist?.bitmagnet_url || 'http://localhost:3333';

    const autoAdd = settings.watchlist?.auto_add !== false;
    const preferredQuality = settings.watchlist?.preferred_quality || '1080p';

    const entries = getWatchlistEntries({ status: 'watching', enabled: true });
    if (entries.length === 0) return;

    log('INFO', `Watchlist: checking ${entries.length} entries`);

    for (const entry of entries) {
        try {
            // Search bitmagnet (DHT crawler + content classifier)
            const bmResults = await searchBitmagnet({
                query: entry.searchQuery,
                categories: [entry.category],
                baseUrl: bitmagnetUrl,
            });

            // Also try with just title + year (broader)
            if (bmResults.length === 0 && entry.year) {
                const broader = await searchBitmagnet({
                    query: `${entry.title} ${entry.year}`,
                    categories: [entry.category],
                    baseUrl: bitmagnetUrl,
                });
                bmResults.push(...broader);
            }

            // Convert to common format
            const results = bmResults.map(r => ({
                title: r.title,
                magnetUri: r.magnetUri,
                seeders: r.seeders,
                leechers: r.leechers,
                size: r.size,
                publishDate: r.publishDate,
                indexer: 'bitmagnet',
                category: [] as number[],
            }));

            emitEvent(WATCHLIST_EVENTS.SEARCH, {
                watchlistId: entry.id,
                title: entry.title,
                resultCount: results.length,
            });

            // Filter: must contain the title, optionally season pattern
            const titleWords = entry.title.toLowerCase().split(/\s+/);
            const filtered = results.filter(r => {
                const rt = r.title.toLowerCase();
                // Every word in the watchlist title must appear in the result
                if (!titleWords.every(w => rt.includes(w))) return false;
                // Year must match if specified
                if (entry.year && !rt.includes(String(entry.year))) return false;
                // Season pattern filter for TV
                if (entry.seasonPattern && !rt.toUpperCase().includes(entry.seasonPattern.toUpperCase())) return false;
                return true;
            });

            // Store results (title-matched only)
            const now = Date.now();
            for (const r of filtered.slice(0, 50)) {
                const qm = computeQualityMatch(r.title, entry.quality);
                insertWatchlistResult({
                    watchlistId: entry.id,
                    title: r.title,
                    magnetUri: r.magnetUri,
                    seeders: r.seeders,
                    leechers: r.leechers,
                    size: r.size,
                    qualityMatch: qm,
                    publishDate: r.publishDate,
                    indexer: r.indexer,
                });
            }

            updateWatchlistEntry(entry.id, { lastCheckedAt: now });

            // Auto-add best match (only from title-matched results)
            if (autoAdd && filtered.length > 0) {
                const ranked = rankResults(filtered, preferredQuality);
                const best = ranked[0];

                if (best && best.seeders > 0 && computeQualityMatch(best.title, preferredQuality) >= 0.5) {
                    // Check for duplicate
                    const infoHash = extractInfoHash(best.magnetUri);
                    const existing = infoHash ? getTorrentByHash(infoHash) : null;

                    if (!existing || existing.status === 'removed') {
                        try {
                            const torrent = await getTorrentManager().addTorrent(best.magnetUri);

                            // Mark the result and update watchlist entry
                            // Find the result we just inserted
                            const allResults = getWatchlistResults(entry.id, 1);
                            if (allResults.length > 0) {
                                markResultSelected(allResults[0].id);
                            }

                            const isTv = entry.mediaType === 'tv' && !entry.seasonPattern;
                            updateWatchlistEntry(entry.id, {
                                lastMatchAt: now,
                                matchedTorrentId: torrent.id,
                                status: isTv ? 'watching' : 'fulfilled',
                            });

                            emitEvent(WATCHLIST_EVENTS.MATCH, {
                                watchlistId: entry.id,
                                title: entry.title,
                                torrentId: torrent.id,
                                torrentName: best.title,
                            });

                            log('INFO', `Watchlist: auto-added "${best.title}" for "${entry.title}"`);
                        } catch (err) {
                            log('ERROR', `Watchlist: failed to add torrent for "${entry.title}": ${(err as Error).message}`);
                        }
                    }
                }
            }
        } catch (err) {
            log('ERROR', `Watchlist: search failed for "${entry.title}": ${(err as Error).message}`);
        }
    }
}

// ── Quality Ranking ───────────────────────────────────────────────────────────

function rankResults(results: SearchResult[], preferredQuality: string): SearchResult[] {
    return [...results].sort((a, b) => {
        const scoreA = computeScore(a, preferredQuality);
        const scoreB = computeScore(b, preferredQuality);
        return scoreB - scoreA;
    });
}

function computeScore(r: SearchResult, preferredQuality: string): number {
    const qm = computeQualityMatch(r.title, preferredQuality);
    const seederScore = Math.min(r.seeders, 100) / 100;
    const recencyScore = r.publishDate
        ? Math.max(0, 1 - (Date.now() - r.publishDate) / (7 * 24 * 60 * 60 * 1000))
        : 0;
    return (qm * 0.6) + (seederScore * 0.3) + (recencyScore * 0.1);
}

function computeQualityMatch(title: string, preferred: string): number {
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

function extractInfoHash(magnetUri: string): string | undefined {
    const match = magnetUri.match(/xt=urn:btih:([a-fA-F0-9]{40})/);
    if (match) return match[1].toLowerCase();
    const b32 = magnetUri.match(/xt=urn:btih:([A-Z2-7]{32})/i);
    if (b32) return b32[1].toLowerCase();
    return undefined;
}
