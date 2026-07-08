import { Hono } from 'hono';
import { getTorrentManager, parseTorrentName, searchReleases, computeQualityMatch } from '@fonte/torrent';
import type { TorrentStatus } from '@fonte/torrent';
import { log, expandHomePath } from '@fonte/core';
import { ok, fail } from '../http';

const app = new Hono();

app.post('/api/torrents', async (c) => {
    try {
        const body = await c.req.json() as { magnetUri?: string; infoHash?: string; filePath?: string; metainfo?: string };
        const source = body.metainfo
            ? Buffer.from(body.metainfo, 'base64')
            : (body.magnetUri || body.infoHash || body.filePath);
        if (!source) {
            return fail(c, 'magnetUri, infoHash, filePath, or metainfo required');
        }

        const manager = getTorrentManager();
        const torrent = await manager.addTorrent(source);
        return ok(c, { torrent });
    } catch (err) {
        const msg = (err as Error).message;
        log('ERROR', `[torrents] Add failed: ${msg}`);
        return fail(c, msg);
    }
});

app.post('/api/torrents/create', async (c) => {
    try {
        const body = await c.req.json() as { path?: string; trackers?: string[] };
        const sourcePath = expandHomePath(body.path?.trim());
        if (!sourcePath) {
            return fail(c, 'path required');
        }

        const manager = getTorrentManager();
        const { torrent, magnetUri, warning } = await manager.createTorrent(sourcePath, body.trackers ?? []);
        return ok(c, { torrent, magnetUri, warning });
    } catch (err) {
        const msg = (err as Error).message;
        log('ERROR', `[torrents] Create failed: ${msg}`);
        return fail(c, msg);
    }
});

app.get('/api/torrents', (c) => {
    const status = c.req.query('status') as TorrentStatus | undefined;
    const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!, 10) : undefined;

    const manager = getTorrentManager();
    const torrents = manager.getTorrents({ status, limit });
    return ok(c, { torrents });
});

app.get('/api/torrents/stats', (c) => {
    const manager = getTorrentManager();
    return ok(c, { ...manager.getStats() });
});

app.get('/api/torrents/config', (c) => {
    const manager = getTorrentManager();
    return ok(c, { config: manager.getConfig() });
});

app.put('/api/torrents/config', async (c) => {
    try {
        const body = await c.req.json();
        const manager = getTorrentManager();
        manager.updateConfig(body);
        return ok(c, { config: manager.getConfig() });
    } catch (err) {
        return fail(c, (err as Error).message);
    }
});

app.get('/api/torrents/:id', (c) => {
    const id = c.req.param('id');
    const manager = getTorrentManager();
    const torrent = manager.getTorrent(id);
    if (!torrent) {
        return fail(c, 'Torrent not found', 404);
    }
    return ok(c, { torrent });
});

app.delete('/api/torrents/:id', async (c) => {
    const id = c.req.param('id');
    const deleteFiles = c.req.query('deleteFiles') === 'true';

    try {
        const manager = getTorrentManager();
        await manager.removeTorrent(id, deleteFiles);
        return ok(c);
    } catch (err) {
        return fail(c, (err as Error).message, 404);
    }
});

app.post('/api/torrents/:id/pause', async (c) => {
    const id = c.req.param('id');
    try {
        const manager = getTorrentManager();
        await manager.pauseTorrent(id);
        return ok(c);
    } catch (err) {
        return fail(c, (err as Error).message, 404);
    }
});

app.post('/api/torrents/:id/resume', async (c) => {
    const id = c.req.param('id');
    try {
        const manager = getTorrentManager();
        await manager.resumeTorrent(id);
        return ok(c);
    } catch (err) {
        return fail(c, (err as Error).message, 404);
    }
});

app.post('/api/torrents/:id/verify', async (c) => {
    const id = c.req.param('id');
    try {
        await getTorrentManager().verifyTorrent(id);
        return ok(c);
    } catch (err) {
        return fail(c, (err as Error).message, 404);
    }
});

app.post('/api/torrents/:id/reannounce', async (c) => {
    const id = c.req.param('id');
    try {
        await getTorrentManager().reannounceTrackers(id);
        return ok(c);
    } catch (err) {
        return fail(c, (err as Error).message, 404);
    }
});

app.post('/api/torrents/:id/alternatives', async (c) => {
    const id = c.req.param('id');
    try {
        const torrent = getTorrentManager().getTorrent(id);
        if (!torrent) return fail(c, 'Torrent not found', 404);

        const parsed = parseTorrentName(torrent.name);
        const quality = torrent.name.match(/(2160p|1080p|720p|480p)/i)?.[1] || '1080p';
        const category = parsed.isTv ? 5000 : 2000;
        const seasonPattern = parsed.isTv ? torrent.name.match(/S\d{2}E\d{2}/i)?.[0] : undefined;

        const results = await searchReleases({ title: parsed.title, year: parsed.year, quality, category, seasonPattern });
        const mapped = results.slice(0, 25).map(r => ({
            title: r.title,
            magnetUri: r.magnetUri,
            seeders: r.seeders,
            leechers: r.leechers,
            size: r.size,
            indexer: r.indexer,
            publishDate: r.publishDate,
            qualityMatch: Math.round(computeQualityMatch(r.title, quality) * 100),
        }));
        return ok(c, { results: mapped });
    } catch (err) {
        return fail(c, (err as Error).message, 500);
    }
});

app.post('/api/torrents/:id/swap', async (c) => {
    const id = c.req.param('id');
    try {
        const body = await c.req.json() as { magnetUri?: string };
        if (!body.magnetUri) return fail(c, 'magnetUri required');

        const manager = getTorrentManager();
        const created = await manager.addTorrent(body.magnetUri);
        await manager.removeTorrent(id, true);
        return ok(c, { torrent: created });
    } catch (err) {
        return fail(c, (err as Error).message);
    }
});

app.get('/api/torrents/:id/files', (c) => {
    const id = c.req.param('id');
    const manager = getTorrentManager();
    const torrent = manager.getTorrent(id);
    if (!torrent) {
        return fail(c, 'Torrent not found', 404);
    }
    const files = manager.getTorrentFiles(id);
    return ok(c, { files });
});

app.post('/api/torrents/:id/files/wanted', async (c) => {
    const id = c.req.param('id');
    const manager = getTorrentManager();
    if (!manager.getTorrent(id)) {
        return fail(c, 'Torrent not found', 404);
    }
    try {
        const body = await c.req.json() as { wanted?: number[]; unwanted?: number[] };
        await manager.setFilesWanted(id, body.wanted || [], body.unwanted || []);
        return ok(c, { files: manager.getTorrentFiles(id) });
    } catch (err) {
        return fail(c, (err as Error).message, 500);
    }
});

export default app;
