import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';

// The count query is cached per jackett url+key with a failure cooldown, so each
// test re-imports the route to start from clean module state.
let tmpHome: string;
let logFile: string;

const JACKETT = 'http://localhost:9117';
const PROBE = '/UI/Dashboard';
const COUNT = '/api/v2.0/indexers/all/results';

beforeAll(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fonte-indexers-route-test-'));
    fs.mkdirSync(path.join(tmpHome, 'logs'), { recursive: true });
    process.env.FONTE_HOME = tmpHome;
    logFile = path.join(tmpHome, 'logs', 'queue.log');
});

afterAll(() => {
    delete process.env.FONTE_HOME;
    fs.rmSync(tmpHome, { recursive: true, force: true });
});

function writeSettings(apiKey = 'test-key'): void {
    fs.writeFileSync(
        path.join(tmpHome, 'settings.json'),
        JSON.stringify({ watchlist: { jackett_url: JACKETT, jackett_api_key: apiKey } }),
    );
}

beforeEach(() => {
    fs.rmSync(logFile, { force: true });
    writeSettings();
    vi.resetModules();
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

type FetchBehavior = { countFails?: boolean; indexerCount?: number };

function stubFetch(behavior: FetchBehavior) {
    const calls = { probe: 0, count: 0 };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        if (url.includes(PROBE)) {
            calls.probe++;
            return new Response('ok', { status: 200 });
        }
        if (url.includes(COUNT)) {
            calls.count++;
            if (behavior.countFails) throw new Error('The operation was aborted due to timeout');
            const indexers = Array.from({ length: behavior.indexerCount ?? 3 }, (_, i) => ({ id: i }));
            return new Response(JSON.stringify({ Indexers: indexers }), { status: 200 });
        }
        throw new Error(`unexpected fetch: ${url}`);
    }));
    return calls;
}

async function loadApp() {
    return (await import('./indexers')).default;
}

async function status(app: Awaited<ReturnType<typeof loadApp>>, query = '') {
    const res = await app.request(`/api/indexers/status${query}`);
    return await res.json() as { ok: boolean; count: number; configured: boolean };
}

function logLines(pattern: RegExp): string[] {
    if (!fs.existsSync(logFile)) return [];
    return fs.readFileSync(logFile, 'utf8').split('\n').filter(l => pattern.test(l));
}

describe('GET /api/indexers/status', () => {
    it('caches a successful count instead of re-querying Jackett', async () => {
        const calls = stubFetch({ indexerCount: 4 });
        const app = await loadApp();

        expect(await status(app)).toMatchObject({ count: 4, configured: true });
        expect(await status(app)).toMatchObject({ count: 4 });

        expect(calls.count).toBe(1);
        expect(calls.probe).toBe(2);
    });

    it('re-queries once the cache TTL expires', async () => {
        const calls = stubFetch({});
        const app = await loadApp();

        await status(app);
        vi.setSystemTime(Date.now() + 11 * 60 * 1000);
        await status(app);

        expect(calls.count).toBe(2);
    });

    it('logs one WARN per outage and suppresses repeats during the cooldown', async () => {
        const calls = stubFetch({ countFails: true });
        const app = await loadApp();

        const first = await status(app);
        const second = await status(app);
        const third = await status(app);

        expect(calls.count).toBe(1);
        expect(logLines(/Indexer count failed/)).toHaveLength(1);
        // A count failure must never flash the first-run "not configured" nudge.
        for (const body of [first, second, third]) expect(body.configured).toBe(true);
    });

    it('retries after the cooldown and logs recovery once', async () => {
        const behavior: FetchBehavior = { countFails: true };
        const calls = stubFetch(behavior);
        const app = await loadApp();

        await status(app);
        expect(logLines(/Indexer count failed/)).toHaveLength(1);

        behavior.countFails = false;
        behavior.indexerCount = 7;
        vi.setSystemTime(Date.now() + 6 * 60 * 1000);
        expect(await status(app)).toMatchObject({ count: 7 });

        expect(calls.count).toBe(2);
        expect(logLines(/Indexer count recovered/)).toHaveLength(1);
        expect(logLines(/Indexer count failed/)).toHaveLength(1);
    });

    it('serves the last known count while failing', async () => {
        const behavior: FetchBehavior = { indexerCount: 5 };
        stubFetch(behavior);
        const app = await loadApp();

        await status(app);
        behavior.countFails = true;
        vi.setSystemTime(Date.now() + 11 * 60 * 1000);

        expect(await status(app)).toMatchObject({ count: 5 });
    });

    it('bypasses the cache and cooldown with fresh=1', async () => {
        const calls = stubFetch({ indexerCount: 2 });
        const app = await loadApp();

        await status(app);
        await status(app, '?fresh=1');

        expect(calls.count).toBe(2);
    });

    it('shares one count query between concurrent requests', async () => {
        const calls = stubFetch({});
        const app = await loadApp();

        await Promise.all([status(app), status(app), status(app)]);

        expect(calls.count).toBe(1);
    });

    it('does not serve a cached count after the Jackett settings change', async () => {
        const calls = stubFetch({ indexerCount: 3 });
        const app = await loadApp();

        await status(app);
        writeSettings('a-different-key');
        await status(app);

        expect(calls.count).toBe(2);
    });

    it('reports jackett-not-configured without touching the network', async () => {
        fs.writeFileSync(path.join(tmpHome, 'settings.json'), JSON.stringify({}));
        const calls = stubFetch({});
        const app = await loadApp();

        const res = await app.request('/api/indexers/status');
        const body = await res.json() as { count: number; configured: boolean; reason: string };

        expect(body).toMatchObject({ count: 0, configured: false, reason: 'jackett-not-configured' });
        expect(calls.probe).toBe(0);
    });
});
