import { Hono } from 'hono';
import { getSettings, log } from '@fonte/core';

const app = new Hono();

// GET /api/indexers/status — count of indexers configured in Jackett.
// The dashboard uses this to nudge first-run users to Jackett's UI when
// the count is 0. Fonte ships with no indexers configured by default.
app.get('/api/indexers/status', async (c) => {
    const settings = getSettings();
    const jackettUrl = settings.watchlist?.jackett_url;
    const apiKey = settings.watchlist?.jackett_api_key;

    if (!jackettUrl || !apiKey) {
        return c.json({ ok: true, count: 0, configured: false, reason: 'jackett-not-configured' });
    }

    // Jackett's /api/v2.0/indexers admin list requires a session cookie;
    // the API-key-friendly way to enumerate configured indexers is to hit
    // the search endpoint and read the Indexers array from the response.
    // We don't care about the actual search hits — the configured list comes
    // back regardless.
    try {
        const url = new URL('/api/v2.0/indexers/all/results', jackettUrl);
        url.searchParams.set('apikey', apiKey);
        url.searchParams.set('Query', '');
        const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) });
        if (!res.ok) {
            return c.json({ ok: true, count: 0, configured: false, reason: 'jackett-unreachable', jackettUrl });
        }
        const body = await res.json() as { Indexers?: unknown[] };
        const count = Array.isArray(body.Indexers) ? body.Indexers.length : 0;
        return c.json({ ok: true, count, configured: count > 0, jackettUrl });
    } catch (err) {
        log('WARN', `Indexer status check failed: ${(err as Error).message}`);
        return c.json({ ok: true, count: 0, configured: false, reason: 'jackett-error', jackettUrl });
    }
});

export default app;
