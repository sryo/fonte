import { log, emitEvent, getSettings } from '@fonte/core';
import {
    searchReleasesReport, describeSearchFailure, rankResults, computeQualityMatch, extractInfoHash,
    type SearchReport, type SourceOutcome,
} from './search-aggregator';
import {
    getWatchlistEntries, updateWatchlistEntry,
    insertWatchlistResult, getWatchlistResultByMagnet, markResultSelected,
    getFeedbackTitles, getBlockedResultKeys, isOngoingWatch, searchYear,
} from './watchlist-db';
import { buildAffinity } from './release-affinity';
import { getTorrentManager } from './torrent-manager';
import { getTorrentByHash } from './torrent-db';
import { backfillPosters } from './poster-manager';
import { WATCHLIST_EVENTS } from './watchlist-events';
import { FailureCounter } from './failure-notices';
import type { WatchlistRecord } from './types';

const DEFAULT_INTERVAL_MINUTES = 30;
const CONCURRENCY = 3;
const MAX_BACKOFF_INTERVALS = 8;

const TICK_MS = 60_000;
const FIRST_TICK_MS = 5_000;

let tickTimer: ReturnType<typeof setTimeout> | null = null;
let lastScheduledRunAt = 0;
let checkInFlight: Promise<void> | null = null;
const failures = new FailureCounter();

type WatchlistSchedule = { enabled?: boolean; check_interval_minutes?: number } | undefined;

export function watchlistCheckDue(watchlist: WatchlistSchedule, lastRunAt: number, now: number): boolean {
    if (!watchlist?.enabled) return false;
    const minutes = watchlist.check_interval_minutes;
    const intervalMs = (minutes && minutes > 0 ? minutes : DEFAULT_INTERVAL_MINUTES) * 60_000;
    return now - lastRunAt >= intervalMs - TICK_MS / 2;
}

function tick(): void {
    tickTimer = setTimeout(tick, TICK_MS);
    const now = Date.now();
    if (!watchlistCheckDue(getSettings().watchlist, lastScheduledRunAt, now)) return;
    lastScheduledRunAt = now;
    runWatchlistCheck().catch(err => {
        log('ERROR', `Watchlist check failed: ${err.message}`);
    });
    // Poster retry piggybacks here so failed lookups get another shot
    // without a scheduler of their own.
    backfillPosters().catch(err => {
        log('WARN', `Poster backfill failed: ${err.message}`);
    });
}

export function startWatchlistRunner(): void {
    if (tickTimer) return;
    lastScheduledRunAt = 0;
    tickTimer = setTimeout(tick, FIRST_TICK_MS);
    log('INFO', 'Watchlist runner started');
}

export function stopWatchlistRunner(): void {
    if (tickTimer) {
        clearTimeout(tickTimer);
        tickTimer = null;
        log('INFO', 'Watchlist runner stopped');
    }
}

/**
 * An entry whose checks keep failing waits 1, 3, 7... intervals between
 * attempts (capped), so a dead source stops burning every cycle. The half
 * interval keeps the first retry on the very next tick.
 */
export function isBackingOff(entry: Pick<WatchlistRecord, 'failCount' | 'lastErrorAt'>, now: number, intervalMs: number): boolean {
    if (!entry.failCount || !entry.lastErrorAt) return false;
    const intervals = Math.min(2 ** (entry.failCount - 1), MAX_BACKOFF_INTERVALS) - 0.5;
    return now - entry.lastErrorAt < intervals * intervalMs;
}

/** A check requested while one is running joins it; the startup run and a manual one otherwise grab the same release twice. */
export function runWatchlistCheck(opts: { force?: boolean } = {}): Promise<void> {
    if (checkInFlight) return checkInFlight;
    checkInFlight = runCheck(opts).finally(() => { checkInFlight = null; });
    return checkInFlight;
}

async function runCheck(opts: { force?: boolean }): Promise<void> {
    const settings = getSettings();
    const jackettUrl = settings.watchlist?.jackett_url;
    const apiKey = settings.watchlist?.jackett_api_key;

    if (!jackettUrl || !apiKey) {
        log('WARN', 'Watchlist: Jackett URL or API key not configured');
        return;
    }

    const autoAdd = settings.watchlist?.auto_add !== false;
    const preferredQuality = settings.watchlist?.preferred_quality || '1080p';
    const intervalMs = (settings.watchlist?.check_interval_minutes || DEFAULT_INTERVAL_MINUTES) * 60_000;

    const all = getWatchlistEntries({ status: 'watching', enabled: true });
    if (all.length === 0) return;
    const now = Date.now();
    const entries = opts.force ? all : all.filter(e => !isBackingOff(e, now, intervalMs));
    const backingOff = all.length - entries.length;

    log('INFO', `Watchlist: checking ${entries.length} entries${backingOff > 0 ? ` (${backingOff} backing off)` : ''}`);
    if (entries.length === 0) return;

    const failedSources = new Map<string, SourceOutcome>();
    const queue = [...entries];
    const worker = async () => {
        for (let entry = queue.shift(); entry; entry = queue.shift()) {
            await checkEntry(entry, { autoAdd, preferredQuality, failedSources });
        }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, entries.length) }, worker));

    if (failedSources.size > 0) {
        log('WARN', `Watchlist: sources that failed this cycle: ${describeSearchFailure({ failed: [...failedSources.values()] })}`);
    }
}

async function checkEntry(
    entry: WatchlistRecord,
    ctx: { autoAdd: boolean; preferredQuality: string; failedSources: Map<string, SourceOutcome> },
): Promise<void> {
    let report: SearchReport;
    try {
        report = await searchReleasesReport({
            title: entry.title,
            year: searchYear(entry.mediaType, entry.year),
            quality: entry.quality,
            category: entry.category,
            seasonPattern: entry.seasonPattern ?? undefined,
        });
    } catch (err) {
        recordFailure(entry, (err as Error).message);
        return;
    }
    if (report.allFailed) {
        recordFailure(entry, describeSearchFailure(report));
        return;
    }
    for (const source of report.failed) ctx.failedSources.set(source.source, source);

    try {
        await persistAndGrab(entry, report, ctx);
    } catch (err) {
        recordFailure(entry, (err as Error).message);
    }
}

function recordFailure(entry: WatchlistRecord, error: string): void {
    const now = Date.now();
    updateWatchlistEntry(entry.id, { lastCheckedAt: now, lastError: error, lastErrorAt: now, failCount: entry.failCount + 1 });
    const { occurrence, notify } = failures.record(entry.id, error);
    emitEvent(WATCHLIST_EVENTS.CHECK_FAILED, {
        watchlistId: entry.id, title: entry.title, error, occurrence, notify,
    });
    log('ERROR', `Watchlist: check failed for "${entry.title}" (${occurrence}x): ${error}`);
}

async function persistAndGrab(
    entry: WatchlistRecord,
    report: SearchReport,
    ctx: { autoAdd: boolean; preferredQuality: string },
): Promise<void> {
    const filtered = report.results;
    emitEvent(WATCHLIST_EVENTS.SEARCH, {
        watchlistId: entry.id,
        title: entry.title,
        resultCount: filtered.length,
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

    updateWatchlistEntry(entry.id, { lastCheckedAt: now, lastError: null, lastErrorAt: null, failCount: 0 });
    failures.clear(entry.id);

    let grabbed = false;
    if (ctx.autoAdd && filtered.length > 0) {
        // The entry's own quality drives ranking and the grab gate: the global
        // preference is a video term ("1080p") that would block music/book
        // grabs; an empty entry quality means any.
        const wantedQuality = entry.quality ?? ctx.preferredQuality;
        const votes = getFeedbackTitles(entry.id);
        const affinity = votes.length > 0
            ? buildAffinity(
                votes.filter(v => v.feedback > 0).map(v => v.title),
                votes.filter(v => v.feedback < 0).map(v => v.title))
            : undefined;
        const ranked = rankResults(filtered, wantedQuality, affinity);
        // Ongoing watches fall through past already-tracked releases. That is
        // what lets a show keep grabbing new episodes after its first,
        // higher-ranked grab (a season pack would otherwise pin ranked[0]
        // forever). One-shot watches only ever consider the top release so an
        // already-tracked best doesn't pull in a duplicate copy of the same movie.
        const pool = isOngoingWatch(entry) ? ranked : ranked.slice(0, 1);
        // A release already tracked by a live torrent row doesn't count as
        // addable; 'removed' tombstones and 'error' rows do, so a failed add
        // doesn't block the release forever (addTorrent replaces such rows).
        // Downvoted and removal-blocked releases are the exception: those
        // never come back.
        const blocked = getBlockedResultKeys(entry.id);
        const best = pool.find((r) => {
            if (!r.seeders || computeQualityMatch(r.title, wantedQuality) < 0.5) return false;
            const infoHash = extractInfoHash(r.magnetUri);
            if ((infoHash && blocked.infoHashes.has(infoHash)) || blocked.magnetUris.has(r.magnetUri)) return false;
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

    // Auto-grabs already announce themselves via MATCH; this covers finds
    // that await the user's pick.
    if (freshCount > 0 && !grabbed) {
        emitEvent(WATCHLIST_EVENTS.RESULTS, {
            watchlistId: entry.id,
            title: entry.title,
            count: freshCount,
        });
    }
}
