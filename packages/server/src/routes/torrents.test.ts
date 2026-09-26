import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

let tmpHome: string;
let app: (typeof import('./torrents'))['default'];
let torrent: typeof import('@fonte/torrent');

beforeAll(async () => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fonte-torrents-route-test-'));
    fs.mkdirSync(path.join(tmpHome, 'logs'), { recursive: true });
    process.env.FONTE_HOME = tmpHome;
    app = (await import('./torrents')).default;
    torrent = await import('@fonte/torrent');
});

afterAll(() => {
    delete process.env.FONTE_HOME;
    fs.rmSync(tmpHome, { recursive: true, force: true });
});

const settingsPath = () => path.join(tmpHome, 'settings.json');
const readSettings = () => JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));

beforeEach(() => {
    fs.writeFileSync(settingsPath(), JSON.stringify({ torrent: { download_dir: '/data/old' } }));
    torrent.createTorrentManager({ download_dir: '/data/old' });
});

async function putConfig(body: unknown) {
    const res = await app.request('/api/torrents/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return { status: res.status, json: await res.json() as Record<string, any> };
}

describe('PUT /api/torrents/config', () => {
    it('expands ~ in the download directory before applying and saving it', async () => {
        const expected = path.join(process.env.HOME || os.homedir(), 'Movies/fonte');
        const { status, json } = await putConfig({ download_dir: '~/Movies/fonte' });
        expect(status).toBe(200);
        expect(json.config.download_dir).toBe(expected);
        expect(readSettings().torrent.download_dir).toBe(expected);
    });

    it('rejects a relative download directory without touching the running or saved config', async () => {
        const { status, json } = await putConfig({ download_dir: 'Downloads' });
        expect(status).toBe(400);
        expect(json.error).toMatch(/absolute/i);
        expect(torrent.getTorrentManager().getConfig().download_dir).toBe('/data/old');
        expect(readSettings().torrent.download_dir).toBe('/data/old');
    });

    it('rejects a negative speed limit', async () => {
        const { status, json } = await putConfig({ max_download_speed: -10 });
        expect(status).toBe(400);
        expect(json.error).toMatch(/max_download_speed/);
        expect(readSettings().torrent.max_download_speed).toBeUndefined();
    });
});
