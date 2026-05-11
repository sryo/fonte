import { Hono } from 'hono';
import {
    getSubtitlesByTorrent, deleteSubtitle,
    fetchSubtitlesForTorrent, translateSubtitle,
} from '@aitorrent/torrent';
import { log } from '@aitorrent/core';

const app = new Hono();

// GET /api/torrents/:id/subtitles — list subtitles for a torrent
app.get('/api/torrents/:id/subtitles', (c) => {
    const torrentId = c.req.param('id');
    const subtitles = getSubtitlesByTorrent(torrentId);
    return c.json({ ok: true, subtitles });
});

// POST /api/torrents/:id/subtitles/fetch — trigger subtitle fetch
app.post('/api/torrents/:id/subtitles/fetch', async (c) => {
    const torrentId = c.req.param('id');
    try {
        await fetchSubtitlesForTorrent(torrentId);
        const subtitles = getSubtitlesByTorrent(torrentId);
        return c.json({ ok: true, subtitles });
    } catch (err) {
        const msg = (err as Error).message;
        log('ERROR', `[subtitles] Fetch failed for torrent ${torrentId}: ${msg}`);
        return c.json({ ok: false, error: msg }, 400);
    }
});

// POST /api/subtitles/:id/translate — translate a subtitle
app.post('/api/subtitles/:id/translate', async (c) => {
    const subtitleId = parseInt(c.req.param('id'), 10);
    if (isNaN(subtitleId)) {
        return c.json({ ok: false, error: 'Invalid subtitle ID' }, 400);
    }

    try {
        const body = await c.req.json() as { language?: string };
        const language = body.language;
        if (!language) {
            return c.json({ ok: false, error: 'language is required' }, 400);
        }

        await translateSubtitle(subtitleId, language);
        return c.json({ ok: true, message: `Translation to ${language} started` });
    } catch (err) {
        const msg = (err as Error).message;
        log('ERROR', `[subtitles] Translate failed for subtitle ${subtitleId}: ${msg}`);
        return c.json({ ok: false, error: msg }, 400);
    }
});

// DELETE /api/subtitles/:id — remove a subtitle
app.delete('/api/subtitles/:id', (c) => {
    const subtitleId = parseInt(c.req.param('id'), 10);
    if (isNaN(subtitleId)) {
        return c.json({ ok: false, error: 'Invalid subtitle ID' }, 400);
    }

    try {
        deleteSubtitle(subtitleId);
        return c.json({ ok: true });
    } catch (err) {
        return c.json({ ok: false, error: (err as Error).message }, 400);
    }
});

export default app;
