import { Hono } from 'hono';
import { getTorrentManager, parseTorrentName, searchReleases, computeQualityMatch } from '@fonte/torrent';
import type { TorrentStatus } from '@fonte/torrent';
import { log } from '@fonte/core';

const app = new Hono();

// POST /api/torrents — add a torrent via magnet URI, info hash, or file path
app.post('/api/torrents', async (c) => {
    try {
        const body = await c.req.json() as { magnetUri?: string; infoHash?: string; filePath?: string };
        const source = body.magnetUri || body.infoHash || body.filePath;
        if (!source) {
            return c.json({ ok: false, error: 'magnetUri, infoHash, or filePath required' }, 400);
        }

        const manager = getTorrentManager();
        const torrent = await manager.addTorrent(source);
        return c.json({ ok: true, torrent });
    } catch (err) {
        const msg = (err as Error).message;
        log('ERROR', `[torrents] Add failed: ${msg}`);
        return c.json({ ok: false, error: msg }, 400);
    }
});

// GET /api/torrents — list all torrents
app.get('/api/torrents', (c) => {
    const status = c.req.query('status') as TorrentStatus | undefined;
    const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!, 10) : undefined;

    const manager = getTorrentManager();
    const torrents = manager.getTorrents({ status, limit });
    return c.json({ ok: true, torrents });
});

// GET /api/torrents/stats — global speed and counts
app.get('/api/torrents/stats', (c) => {
    const manager = getTorrentManager();
    return c.json({ ok: true, ...manager.getStats() });
});

// GET /api/torrents/config — current torrent configuration
app.get('/api/torrents/config', (c) => {
    const manager = getTorrentManager();
    return c.json({ ok: true, config: manager.getConfig() });
});

// PUT /api/torrents/config — update torrent configuration
app.put('/api/torrents/config', async (c) => {
    try {
        const body = await c.req.json();
        const manager = getTorrentManager();
        manager.updateConfig(body);
        return c.json({ ok: true, config: manager.getConfig() });
    } catch (err) {
        return c.json({ ok: false, error: (err as Error).message }, 400);
    }
});

// GET /api/torrents/:id — single torrent detail
app.get('/api/torrents/:id', (c) => {
    const id = c.req.param('id');
    const manager = getTorrentManager();
    const torrent = manager.getTorrent(id);
    if (!torrent) {
        return c.json({ ok: false, error: 'Torrent not found' }, 404);
    }
    return c.json({ ok: true, torrent });
});

// DELETE /api/torrents/:id — remove a torrent
app.delete('/api/torrents/:id', (c) => {
    const id = c.req.param('id');
    const deleteFiles = c.req.query('deleteFiles') === 'true';

    try {
        const manager = getTorrentManager();
        manager.removeTorrent(id, deleteFiles);
        return c.json({ ok: true });
    } catch (err) {
        return c.json({ ok: false, error: (err as Error).message }, 404);
    }
});

// POST /api/torrents/:id/pause — pause a torrent
app.post('/api/torrents/:id/pause', (c) => {
    const id = c.req.param('id');
    try {
        const manager = getTorrentManager();
        manager.pauseTorrent(id);
        return c.json({ ok: true });
    } catch (err) {
        return c.json({ ok: false, error: (err as Error).message }, 404);
    }
});

// POST /api/torrents/:id/resume — resume a torrent
app.post('/api/torrents/:id/resume', (c) => {
    const id = c.req.param('id');
    try {
        const manager = getTorrentManager();
        manager.resumeTorrent(id);
        return c.json({ ok: true });
    } catch (err) {
        return c.json({ ok: false, error: (err as Error).message }, 404);
    }
});

// POST /api/torrents/:id/verify — re-check downloaded data
app.post('/api/torrents/:id/verify', async (c) => {
    const id = c.req.param('id');
    try {
        await getTorrentManager().verifyTorrent(id);
        return c.json({ ok: true });
    } catch (err) {
        return c.json({ ok: false, error: (err as Error).message }, 404);
    }
});

// POST /api/torrents/:id/reannounce — ask trackers for peers now
app.post('/api/torrents/:id/reannounce', async (c) => {
    const id = c.req.param('id');
    try {
        await getTorrentManager().reannounceTrackers(id);
        return c.json({ ok: true });
    } catch (err) {
        return c.json({ ok: false, error: (err as Error).message }, 404);
    }
});

// POST /api/torrents/:id/alternatives — search indexers for other releases of the same title
app.post('/api/torrents/:id/alternatives', async (c) => {
    const id = c.req.param('id');
    try {
        const torrent = getTorrentManager().getTorrent(id);
        if (!torrent) return c.json({ ok: false, error: 'Torrent not found' }, 404);

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
        return c.json({ ok: true, results: mapped });
    } catch (err) {
        return c.json({ ok: false, error: (err as Error).message }, 500);
    }
});

// POST /api/torrents/:id/swap — add an alternative release and remove the stuck torrent
app.post('/api/torrents/:id/swap', async (c) => {
    const id = c.req.param('id');
    try {
        const body = await c.req.json() as { magnetUri?: string };
        if (!body.magnetUri) return c.json({ ok: false, error: 'magnetUri required' }, 400);

        const manager = getTorrentManager();
        const created = await manager.addTorrent(body.magnetUri);
        await manager.removeTorrent(id, true);
        return c.json({ ok: true, torrent: created });
    } catch (err) {
        return c.json({ ok: false, error: (err as Error).message }, 400);
    }
});

// GET /api/torrents/:id/files — list files within a torrent
app.get('/api/torrents/:id/files', (c) => {
    const id = c.req.param('id');
    const manager = getTorrentManager();
    const torrent = manager.getTorrent(id);
    if (!torrent) {
        return c.json({ ok: false, error: 'Torrent not found' }, 404);
    }
    const files = manager.getTorrentFiles(id);
    return c.json({ ok: true, files });
});

// POST /api/torrents/:id/files/wanted — set wanted/unwanted file indices
app.post('/api/torrents/:id/files/wanted', async (c) => {
    const id = c.req.param('id');
    const manager = getTorrentManager();
    if (!manager.getTorrent(id)) {
        return c.json({ ok: false, error: 'Torrent not found' }, 404);
    }
    try {
        const body = await c.req.json() as { wanted?: number[]; unwanted?: number[] };
        await manager.setFilesWanted(id, body.wanted || [], body.unwanted || []);
        return c.json({ ok: true, files: manager.getTorrentFiles(id) });
    } catch (err) {
        return c.json({ ok: false, error: (err as Error).message }, 500);
    }
});

export default app;
