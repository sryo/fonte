import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

// SETTINGS_FILE derives from FONTE_HOME, which @fonte/core resolves once at
// import time — so one temp home for the whole file, set before the first
// dynamic import. Each test rewrites or removes settings.json as needed.
// The routes are tested in isolation: this module's default export is a
// self-contained Hono app, no torrent manager or HTTP server required.
let tmpHome: string;
let app: (typeof import('./settings'))['default'];

beforeAll(async () => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fonte-settings-route-test-'));
    // PUT /api/settings logs via @fonte/core, which appends to logs/queue.log
    // and fails if the directory is missing
    fs.mkdirSync(path.join(tmpHome, 'logs'), { recursive: true });
    process.env.FONTE_HOME = tmpHome;
    app = (await import('./settings')).default;
});

afterAll(() => {
    delete process.env.FONTE_HOME;
    fs.rmSync(tmpHome, { recursive: true, force: true });
});

function settingsPath(): string {
    return path.join(tmpHome, 'settings.json');
}

beforeEach(() => {
    fs.rmSync(settingsPath(), { force: true });
});

async function putSettings(body: unknown): Promise<Response> {
    return app.request('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

describe('GET /api/settings', () => {
    it('returns the bare settings object with no wrapper', async () => {
        // characterizes current behavior: unlike PUT, the response is the raw
        // settings object — no { ok, settings } envelope
        const res = await app.request('/api/settings');
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({});
    });

    it('returns settings.json contents as-is', async () => {
        const settings = {
            watchlist: { jackett_url: 'http://localhost:9117' },
            subtitles: { enabled: true, tmdb_api_key: 'tmdb' },
        };
        fs.writeFileSync(settingsPath(), JSON.stringify(settings));

        const res = await app.request('/api/settings');
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual(settings);
    });
});

describe('PUT /api/settings', () => {
    it('merges shallowly, replacing nested sections wholesale', async () => {
        fs.writeFileSync(settingsPath(), JSON.stringify({
            subtitles: { enabled: true, tmdb_api_key: 'tmdb' },
            watchlist: { jackett_url: 'http://localhost:9117' },
        }));

        const res = await putSettings({ subtitles: { enabled: false } });
        expect(res.status).toBe(200);

        // characterizes current behavior: the merge is top-level only, so the
        // untouched subtitles.tmdb_api_key is lost along with the section
        const merged = {
            subtitles: { enabled: false },
            watchlist: { jackett_url: 'http://localhost:9117' },
        };
        expect(await res.json()).toEqual({ ok: true, settings: merged });
        expect(JSON.parse(fs.readFileSync(settingsPath(), 'utf8'))).toEqual(merged);
    });

    it('creates settings.json when none exists', async () => {
        const res = await putSettings({ torrents: { download_dir: '/downloads' } });

        expect(await res.json()).toEqual({
            ok: true,
            settings: { torrents: { download_dir: '/downloads' } },
        });
        expect(JSON.parse(fs.readFileSync(settingsPath(), 'utf8')))
            .toEqual({ torrents: { download_dir: '/downloads' } });
    });
});
