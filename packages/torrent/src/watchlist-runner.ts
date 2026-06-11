import { Cron } from 'croner';
import { log, emitEvent, getSettings } from '@fonte/core';
import { aggregateSearch, filterByTitle, rankResults, computeQualityMatch, extractInfoHash } from './search-aggregator';
import {
    getWatchlistEntries, updateWatchlistEntry,
    insertWatchlistResult, getWatchlistResultByMagnet, markResultSelected,
} from './watchlist-db';
import { getTorrentManager } from './torrent-manager';
import { getTorrentByHash } from './torrent-db';
import { WATCHLIST_EVENTS } from './watchlist-events';

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
    const jackettUrl = settings.watchlist?.jackett_url;
    const apiKey = settings.watchlist?.jackett_api_key;

    if (!jackettUrl || !apiKey) {
        log('WARN', 'Watchlist: Jackett URL or API key not configured');
        return;
    }

    const autoAdd = settings.watchlist?.auto_add !== false;
    const preferredQuality = settings.watchlist?.preferred_quality || '1080p';

    const entries = getWatchlistEntries({ status: 'watching', enabled: true });
    if (entries.length === 0) return;

    log('INFO', `Watchlist: checking ${entries.length} entries`);

    for (const entry of entries) {
        try {
            const results = await aggregateSearch([entry.searchQuery], {
                categories: [entry.category],
                jackettUrl,
                apiKey,
                jackettErrors: 'throw',
            });

            emitEvent(WATCHLIST_EVENTS.SEARCH, {
                watchlistId: entry.id,
                title: entry.title,
                resultCount: results.length,
            });

            const filtered = filterByTitle(results, {
                title: entry.title,
                year: entry.year,
                seasonPattern: entry.seasonPattern,
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

                            const selected = getWatchlistResultByMagnet(entry.id, best.magnetUri);
                            if (selected) {
                                markResultSelected(selected.id);
                            }

                            const isOngoing = (entry.mediaType === 'tv' || entry.mediaType === 'music') && !entry.seasonPattern;
                            updateWatchlistEntry(entry.id, {
                                lastMatchAt: now,
                                matchedTorrentId: torrent.id,
                                status: isOngoing ? 'watching' : 'fulfilled',
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

