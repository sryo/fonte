import { existsSync } from 'fs';
import path from 'path';
import { Hono } from 'hono';
import { getTorrentManager, parseTorrentName, searchReleases, computeQualityMatch } from '@fonte/torrent';
import type { TorrentStatus } from '@fonte/torrent';
import { log, expandHomePath, validateSettings, revealInFinder } from '@fonte/core';
import { ok, fail } from '../http';
import { mutateSettings } from './settings';

const app = new Hono();

app.post('/api/torrents', async (c) => {
    try {
        const body = await c.req.json() as { magnetUri?: string; infoHash?: string; filePath?: string; metainfo?: string };
        const raw = body.metainfo
            ? Buffer.from(body.metainfo, 'base64')
            : (body.magnetUri || body.infoHash || body.filePath);
        if (!raw) {
            return fail(c, 'magnetUri, infoHash, filePath, or metainfo required');
        }

        const manager = getTorrentManager();
        const torrent = await manager.addTorrent(raw);
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
    // Keys stay top-level for wire compat (CLI + agent API docs), but are
    // spelled out so a future TorrentStats field can't collide with the
    // envelope's own keys.
    const stats = getTorrentManager().getStats();
    return ok(c, {
        downloadSpeed: stats.downloadSpeed,
        uploadSpeed: stats.uploadSpeed,
        activeTorrents: stats.activeTorrents,
        totalTorrents: stats.totalTorrents,
    });
});

app.get('/api/torrents/config', (c) => {
    const manager = getTorrentManager();
    return ok(c, { config: manager.getConfig() });
});

app.put('/api/torrents/config', async (c) => {
    try {
        const body = await c.req.json();
        // Same strictness as PUT /api/settings.
        const { typeErrors, warnings } = validateSettings({ torrent: body });
        if (typeErrors.length || warnings.length) {
            return fail(c, [...typeErrors, ...warnings].join('; '));
        }
        const manager = getTorrentManager();
        await manager.updateConfig(body);
        await mutateSettings((s) => {
            s.torrent = { ...s.torrent, ...body };
        });
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

// The API is unauthenticated loopback, so this only ever reveals paths
// resolved from the torrent's own record — never a caller-supplied one.
app.post('/api/torrents/:id/reveal', async (c) => {
    if (process.platform !== 'darwin') {
        return fail(c, 'Reveal in Finder is only supported on macOS');
    }
    const id = c.req.param('id');
    const manager = getTorrentManager();
    const torrent = manager.getTorrent(id);
    if (!torrent) {
        return fail(c, 'Torrent not found', 404);
    }
    const body = await c.req.json().catch(() => ({})) as { path?: string };
    let abs: string;
    if (body.path) {
        const files = manager.getTorrentFiles(id);
        if (!files.some((f) => f.path === body.path)) {
            return fail(c, 'Unknown file path', 404);
        }
        abs = path.join(torrent.savePath, body.path);
    } else {
        abs = path.join(torrent.savePath, torrent.name);
    }
    if (!existsSync(abs)) {
        return fail(c, 'Not on disk yet', 404);
    }
    try {
        await revealInFinder(abs);
        return ok(c);
    } catch (err) {
        return fail(c, (err as Error).message, 500);
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
    let body: { magnetUris?: string[]; magnetUri?: string };
    try {
        body = await c.req.json();
    } catch {
        return fail(c, 'magnetUris required');
    }
    const candidates = (body.magnetUris ?? (body.magnetUri ? [body.magnetUri] : []))
        .filter((u): u is string => typeof u === 'string' && u.length > 0);
    if (candidates.length === 0) return fail(c, 'magnetUris required');

    const manager = getTorrentManager();
    // Try the chosen release first, then fall through to the remaining
    // alternatives; addTorrent resolves each link before any DB write, so a
    // dead indexer link throws without littering the Issues list.
    const errors: string[] = [];
    for (const uri of candidates) {
        let created;
        try {
            created = await manager.addTorrent(uri);
        } catch (err) {
            errors.push((err as Error).message);
            continue;
        }
        // The swap succeeded once the replacement exists; a failure removing
        // the old torrent must not fall through and add a second candidate.
        try {
            await manager.removeTorrent(id, true);
        } catch (err) {
            log('WARN', `Swap added ${created.id} but could not remove ${id}: ${(err as Error).message}`);
        }
        return ok(c, { torrent: created });
    }
    log('WARN', `Swap failed for ${id}: ${errors.join(' | ')}`);
    return fail(c, candidates.length === 1
        ? errors[0]
        : `None of the ${candidates.length} alternatives could be loaded`, 502);
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

// Wire priorities are named levels; Transmission's -1/0/1 stays internal.
const PRIORITY_LEVELS: Record<string, -1 | 0 | 1> = { low: -1, normal: 0, high: 1 };

app.post('/api/torrents/:id/files/priority', async (c) => {
    const id = c.req.param('id');
    const manager = getTorrentManager();
    if (!manager.getTorrent(id)) {
        return fail(c, 'Torrent not found', 404);
    }
    const body = await c.req.json().catch(() => ({})) as { indices?: number[]; priority?: string };
    const level = body.priority !== undefined ? PRIORITY_LEVELS[body.priority] : undefined;
    if (level === undefined) {
        return fail(c, 'priority must be "high", "normal", or "low"');
    }
    if (!Array.isArray(body.indices) || body.indices.length === 0 || !body.indices.every(i => Number.isInteger(i) && i >= 0)) {
        return fail(c, 'indices must be a non-empty array of file indices');
    }
    try {
        await manager.setFilePriority(id, body.indices, level);
        return ok(c, { files: manager.getTorrentFiles(id) });
    } catch (err) {
        return fail(c, (err as Error).message, 500);
    }
});

app.post('/api/torrents/:id/priority', async (c) => {
    const id = c.req.param('id');
    const manager = getTorrentManager();
    if (!manager.getTorrent(id)) {
        return fail(c, 'Torrent not found', 404);
    }
    const body = await c.req.json().catch(() => ({})) as { priority?: string };
    const level = body.priority !== undefined ? PRIORITY_LEVELS[body.priority] : undefined;
    if (level === undefined) {
        return fail(c, 'priority must be "high", "normal", or "low"');
    }
    try {
        await manager.setBandwidthPriority(id, level);
        return ok(c);
    } catch (err) {
        return fail(c, (err as Error).message, 500);
    }
});

app.post('/api/torrents/:id/queue', async (c) => {
    const id = c.req.param('id');
    const manager = getTorrentManager();
    if (!manager.getTorrent(id)) {
        return fail(c, 'Torrent not found', 404);
    }
    const body = await c.req.json().catch(() => ({})) as { move?: string | number };
    const move = body.move;
    const isDirection = move === 'top' || move === 'up' || move === 'down' || move === 'bottom';
    const isPosition = typeof move === 'number' && Number.isInteger(move) && move >= 0;
    if (!isDirection && !isPosition) {
        return fail(c, 'move must be "top", "up", "down", "bottom", or a position number');
    }
    try {
        await manager.moveInQueue(id, move as 'top' | 'up' | 'down' | 'bottom' | number);
        return ok(c);
    } catch (err) {
        return fail(c, (err as Error).message, 500);
    }
});

export default app;
