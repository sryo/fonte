import { Hono } from 'hono';
import {
    getSubtitlesByTorrent, deleteSubtitle,
    fetchSubtitlesForTorrent, translateSubtitle,
} from '@fonte/torrent';
import { log } from '@fonte/core';
import { ok, fail } from '../http';

const app = new Hono();

app.get('/api/torrents/:id/subtitles', (c) => {
    const torrentId = c.req.param('id');
    const subtitles = getSubtitlesByTorrent(torrentId);
    return ok(c, { subtitles });
});

app.post('/api/torrents/:id/subtitles/fetch', async (c) => {
    const torrentId = c.req.param('id');
    try {
        await fetchSubtitlesForTorrent(torrentId);
        const subtitles = getSubtitlesByTorrent(torrentId);
        return ok(c, { subtitles });
    } catch (err) {
        const msg = (err as Error).message;
        log('ERROR', `[subtitles] Fetch failed for torrent ${torrentId}: ${msg}`);
        return fail(c, msg);
    }
});

app.post('/api/subtitles/:id/translate', async (c) => {
    const subtitleId = parseInt(c.req.param('id'), 10);
    if (isNaN(subtitleId)) {
        return fail(c, 'Invalid subtitle ID');
    }

    try {
        const body = await c.req.json() as { language?: string };
        const language = body.language;
        if (!language) {
            return fail(c, 'language is required');
        }

        await translateSubtitle(subtitleId, language);
        return ok(c, { message: `Translation to ${language} started` });
    } catch (err) {
        const msg = (err as Error).message;
        log('ERROR', `[subtitles] Translate failed for subtitle ${subtitleId}: ${msg}`);
        return fail(c, msg);
    }
});

app.delete('/api/subtitles/:id', (c) => {
    const subtitleId = parseInt(c.req.param('id'), 10);
    if (isNaN(subtitleId)) {
        return fail(c, 'Invalid subtitle ID');
    }

    try {
        deleteSubtitle(subtitleId);
        return ok(c);
    } catch (err) {
        return fail(c, (err as Error).message);
    }
});

export default app;
