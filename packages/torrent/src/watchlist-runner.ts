import { Cron } from 'croner';
import { log, emitEvent, getSettings } from '@fonte/core';
import { aggregateSearch, filterByTitle, rankResults, computeQualityMatch, extractInfoHash } from './search-aggregator';
import {
    getWatchlistEntries, updateWatchlistEntry,
    insertWatchlistResult, getWatchlistResultByMagnet, markResultSelected,
    isOngoingWatch,
} from './watchlist-db';
import { getTorrentManager } from './torrent-manager';
import { getTorrentByHash } from './torrent-db';
import { backfillPosters } from './poster-manager';
import { WATCHLIST_EVENTS } from './watchlist-events';

let watchlistJob: Cron | null = null;

export function startWatchlistRunner(intervalMinutes: number): void {
    if (watchlistJob) return;

    const cron = `*/${intervalMinutes} * * * *`;
    watchlistJob = new Cron(cron, () => {
        runWatchlistCheck().catch(err => {
            log('ERROR', `Watchlist check failed: ${err.message}`);
        });
        // Poster retry piggybacks here so failed lookups get another shot
        // without a scheduler of their own.
        backfillPosters().catch(err => {
            log('WARN', `Poster backfill failed: ${err.message}`);
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
                // Year narrows everything except episodic TV releases.
                year: entry.mediaType !== 'tv' ? entry.year ?? undefined : undefined,
                seasonPattern: entry.seasonPattern,
            });

            const now = Date.now();
            let freshCount = 0;
            for (const r of filtered.slice(0, 50)) {
                const qm = computeQualityMatch(r.title, entry.quality);
                const { created } = insertWatchlistResult({
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
                if (created) freshCount++;
            }

            updateWatchlistEntry(entry.id, { lastCheckedAt: now });

            let grabbed = false;
            if (autoAdd && filtered.length > 0) {
                // The entry's own quality drives ranking and the grab gate —
                // the global preference is a video term ("1080p") that would
                // block music/book grabs; an empty entry quality means any.
                const wantedQuality = entry.quality ?? preferredQuality;
                const ranked = rankResults(filtered, wantedQuality);
                // Ongoing watches fall through past already-tracked releases —
                // that's what lets a show keep grabbing new episodes after its
                // first, higher-ranked grab (a season pack would otherwise pin
                // ranked[0] forever). One-shot watches only ever consider the
                // top release so an already-tracked best doesn't pull in a
                // duplicate copy of the same movie.
                const pool = isOngoingWatch(entry) ? ranked : ranked.slice(0, 1);
                // A release already tracked by a live torrent row doesn't
                // count as addable; 'removed' tombstones and 'error' rows do,
                // so a failed add doesn't block the release forever —
                // addTorrent replaces such rows.
                const best = pool.find((r) => {
                    if (r.seeders <= 0 || computeQualityMatch(r.title, wantedQuality) < 0.5) return false;
                    const infoHash = extractInfoHash(r.magnetUri);
                    const existing = infoHash ? getTorrentByHash(infoHash) : null;
                    return !existing || existing.status === 'removed' || existing.status === 'error';
                });

                if (best) {
                    try {
                        const torrent = await getTorrentManager().addTorrent(best.magnetUri, { name: best.title });

                        const selected = getWatchlistResultByMagnet(entry.id, best.magnetUri);
                        if (selected) {
                            markResultSelected(selected.id);
                        }

                        updateWatchlistEntry(entry.id, {
                            lastMatchAt: now,
                            matchedTorrentId: torrent.id,
                            status: isOngoingWatch(entry) ? 'watching' : 'fulfilled',
                        });

                        emitEvent(WATCHLIST_EVENTS.MATCH, {
                            watchlistId: entry.id,
                            title: entry.title,
                            torrentId: torrent.id,
                            torrentName: best.title,
                        });

                        log('INFO', `Watchlist: auto-added "${best.title}" for "${entry.title}"`);
                        grabbed = true;
                    } catch (err) {
                        log('ERROR', `Watchlist: failed to add torrent for "${entry.title}": ${(err as Error).message}`);
                    }
                }
            }

            // Auto-grabs already announce themselves via MATCH; this covers
            // finds that await the user's pick.
            if (freshCount > 0 && !grabbed) {
                emitEvent(WATCHLIST_EVENTS.RESULTS, {
                    watchlistId: entry.id,
                    title: entry.title,
                    count: freshCount,
                });
            }
        } catch (err) {
            log('ERROR', `Watchlist: search failed for "${entry.title}": ${(err as Error).message}`);
        }
    }
}

