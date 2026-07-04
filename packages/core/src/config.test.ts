import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// config.ts resolves FONTE_HOME once at import time, so every test resets the
// module registry and re-imports after pointing FONTE_HOME at a fresh temp dir.
let tmpHome: string;

beforeEach(() => {
    vi.resetModules();
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fonte-config-test-'));
    process.env.FONTE_HOME = tmpHome;
});

afterEach(() => {
    delete process.env.FONTE_HOME;
    fs.rmSync(tmpHome, { recursive: true, force: true });
});

function settingsPath(): string {
    return path.join(tmpHome, 'settings.json');
}

async function loadConfig(): Promise<typeof import('./config')> {
    return import('./config');
}

describe('getSettings', () => {
    it('returns {} when settings.json does not exist', async () => {
        const { getSettings } = await loadConfig();
        expect(getSettings()).toEqual({});
    });

    it('round-trips a valid settings.json without touching the file', async () => {
        const settings = {
            watchlist: { jackett_url: 'http://localhost:9117', jackett_api_key: 'key' },
            subtitles: { enabled: true, target_languages: ['en', 'es'] },
        };
        const raw = JSON.stringify(settings, null, 4);
        fs.writeFileSync(settingsPath(), raw);

        const { getSettings } = await loadConfig();
        expect(getSettings()).toEqual(settings);
        expect(fs.readFileSync(settingsPath(), 'utf8')).toBe(raw);
    });

    it('auto-detects the provider from configured model sections in memory only', async () => {
        const raw = JSON.stringify({ models: { anthropic: { api_key: 'k' } } });
        fs.writeFileSync(settingsPath(), raw);

        const { getSettings } = await loadConfig();
        expect(getSettings().models?.provider).toBe('anthropic');
        // the detected provider is not persisted back to disk
        expect(fs.readFileSync(settingsPath(), 'utf8')).toBe(raw);
    });

    it('repairs a trailing comma, rewrites the file, and keeps a backup', async () => {
        const corrupt = '{\n  "watchlist": { "jackett_url": "http://j" },\n}';
        fs.writeFileSync(settingsPath(), corrupt);

        const { getSettings } = await loadConfig();
        expect(getSettings()).toEqual({ watchlist: { jackett_url: 'http://j' } });

        expect(JSON.parse(fs.readFileSync(settingsPath(), 'utf8')))
            .toEqual({ watchlist: { jackett_url: 'http://j' } });
        expect(fs.readFileSync(settingsPath() + '.bak', 'utf8')).toBe(corrupt);
    });

    it('silently returns {} for unrecoverable garbage', async () => {
        // characterizes current behavior: an empty file cannot be repaired, so
        // getSettings falls back to {} without signalling the caller
        fs.writeFileSync(settingsPath(), '');

        const { getSettings } = await loadConfig();
        expect(getSettings()).toEqual({});
        expect(fs.readFileSync(settingsPath(), 'utf8')).toBe('');
        expect(fs.existsSync(settingsPath() + '.bak')).toBe(false);
    });

    it('rejects bare text repaired into a non-object without touching the file', async () => {
        // jsonrepair turns unquoted text into a JSON string literal; a
        // non-object result is rejected and never written back
        fs.writeFileSync(settingsPath(), 'not json at all');

        const { getSettings } = await loadConfig();
        expect(getSettings()).toEqual({});
        expect(fs.readFileSync(settingsPath(), 'utf8')).toBe('not json at all');
        expect(fs.existsSync(settingsPath() + '.bak')).toBe(false);
    });
});
