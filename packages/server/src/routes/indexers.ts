import fs from 'fs';
import { execFile } from 'child_process';
import { Hono } from 'hono';
import { getSettings, log } from '@fonte/core';
import { ok, fail } from '../http';

const app = new Hono();

// Counting indexers runs a real multi-indexer search that can take 10s+, and the
// dashboard polls status every 30s. Without this cache a slow Jackett produced one
// WARN per poll for hours. Cached by url+key so a settings change can't serve a
// stale count; ?fresh=1 (settings "Test connection") bypasses cache and cooldown.
const COUNT_TTL_MS = 10 * 60 * 1000;
const FAIL_COOLDOWN_MS = 5 * 60 * 1000;
let countCache: { key: string; count: number; fetchedAt: number } | null = null;
let countFailure: { key: string; cooldownUntil: number } | null = null;
let countInFlight: { key: string; promise: Promise<CountResult> } | null = null;

type CountResult = { count: number } | { error: string };

async function queryIndexerCount(jackettUrl: string, apiKey: string): Promise<CountResult> {
    try {
        const url = new URL('/api/v2.0/indexers/all/results', jackettUrl);
        url.searchParams.set('apikey', apiKey);
        url.searchParams.set('Query', '');
        const res = await fetch(url.toString(), { signal: AbortSignal.timeout(20000) });
        if (!res.ok) return { error: `HTTP ${res.status}` };
        const body = await res.json() as { Indexers?: unknown[] };
        return { count: Array.isArray(body.Indexers) ? body.Indexers.length : 0 };
    } catch (err) {
        return { error: (err as Error).message };
    }
}

// GET /api/indexers/status — is Jackett up, and how many indexers are configured.
// The dashboard uses this both to nudge first-run users (count 0) and to offer
// a restart when Jackett is down. Reachability and counting are separate checks:
// enumerating indexers runs a real multi-indexer search that can take 10s+ and
// time out even on a healthy Jackett, so it must NOT decide "Jackett is down".
// Every branch is ok() with a `reason` — an unreachable Jackett is a reportable
// state, not an API error.
app.get('/api/indexers/status', async (c) => {
    const settings = getSettings();
    const jackettUrl = settings.watchlist?.jackett_url;
    const apiKey = settings.watchlist?.jackett_api_key;

    if (!jackettUrl || !apiKey) {
        return ok(c, { count: 0, configured: false, reason: 'jackett-not-configured' });
    }

    // Reachability: any HTTP response (even a 302 to the login flow) means the
    // process is up. Only a network error/timeout is a real outage. redirect
    // 'manual' keeps a 3xx from counting as a failure.
    try {
        await fetch(new URL('/UI/Dashboard', jackettUrl).toString(), {
            signal: AbortSignal.timeout(5000),
            redirect: 'manual',
        });
    } catch (err) {
        log('WARN', `Jackett unreachable: ${(err as Error).message}`);
        return ok(c, { count: 0, configured: false, reason: 'jackett-error', jackettUrl });
    }

    // Reachable — count configured indexers via the API-key-friendly search
    // endpoint (the admin list needs a session cookie). This is the slow part;
    // if it fails, fall back to the last known count rather than reporting a
    // false "not configured" against a Jackett that's actually up.
    const key = `${jackettUrl}|${apiKey}`;
    const fresh = c.req.query('fresh') === '1';

    if (countFailure && countFailure.key !== key) countFailure = null;

    // Up but couldn't enumerate: last known count, else assume configured so a
    // transient count failure never flashes the first-run nudge.
    const staleCount = () => (countCache?.key === key ? countCache.count : 1);

    if (!fresh && countCache?.key === key && Date.now() - countCache.fetchedAt < COUNT_TTL_MS) {
        return ok(c, { count: countCache.count, configured: countCache.count > 0, jackettUrl });
    }

    if (!fresh && countFailure && Date.now() < countFailure.cooldownUntil) {
        const count = staleCount();
        return ok(c, { count, configured: count > 0, jackettUrl });
    }

    if (!countInFlight || countInFlight.key !== key) {
        countInFlight = { key, promise: queryIndexerCount(jackettUrl, apiKey) };
        countInFlight.promise.finally(() => {
            if (countInFlight?.key === key) countInFlight = null;
        });
    }
    const result = await countInFlight.promise;

    if ('count' in result) {
        if (countFailure) log('INFO', 'Indexer count recovered');
        countCache = { key, count: result.count, fetchedAt: Date.now() };
        countFailure = null;
        return ok(c, { count: result.count, configured: result.count > 0, jackettUrl });
    }

    if (!countFailure) log('WARN', `Indexer count failed (Jackett is up): ${result.error}`);
    countFailure = { key, cooldownUntil: Date.now() + FAIL_COOLDOWN_MS };
    const count = staleCount();
    return ok(c, { count, configured: count > 0, jackettUrl });
});

// POST /api/indexers/jackett/restart — restart the Homebrew-managed Jackett
// service. macOS/Homebrew-specific and best-effort: the dashboard offers this
// when Jackett is unreachable, the common cause being a stale process left
// behind by a `brew upgrade`. Fixed argv (no shell, no interpolated input);
// a non-brew install gets a clean failure the UI surfaces.
app.post('/api/indexers/jackett/restart', async (c) => {
    const brew = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'].find(p => fs.existsSync(p));
    if (!brew) {
        return fail(c, 'Homebrew not found — restart Jackett manually', 500);
    }

    try {
        await new Promise<void>((resolve, reject) => {
            execFile(brew, ['services', 'restart', 'jackett'], { timeout: 30000 }, (err) => {
                // brew prints tap-deprecation warnings to stderr on success;
                // trust the exit code (surfaced as err) rather than stderr.
                if (err) reject(err);
                else resolve();
            });
        });
        log('INFO', '[indexers] Restarted Jackett via brew services');
        return ok(c, { restarted: true });
    } catch (err) {
        const msg = (err as Error).message;
        log('ERROR', `[indexers] Jackett restart failed: ${msg}`);
        return fail(c, `Restart failed: ${msg}`, 500);
    }
});

export default app;
