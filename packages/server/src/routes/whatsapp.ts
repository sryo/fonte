import fs from 'fs';
import { Hono } from 'hono';
import { getWhatsAppService } from '@aitorrent/torrent';
import { getSettings, SETTINGS_FILE, log } from '@aitorrent/core';
import type { Settings } from '@aitorrent/core';

const app = new Hono();

app.post('/api/whatsapp/start', async (c) => {
    try {
        const service = getWhatsAppService();
        await service.start();
        return c.json({ ok: true, status: service.status });
    } catch (err) {
        return c.json({ ok: false, error: (err as Error).message }, 500);
    }
});

app.get('/api/whatsapp/status', (c) => {
    const service = getWhatsAppService();
    return c.json({ ok: true, ...service.getStatusInfo() });
});

app.get('/api/whatsapp/qr', (c) => {
    const service = getWhatsAppService();
    const qr = service.qr;
    if (!qr) return c.json({ ok: false, error: 'No QR available' }, 404);
    return c.json({ ok: true, qr });
});

app.post('/api/whatsapp/disconnect', async (c) => {
    try {
        await getWhatsAppService().stop();
        return c.json({ ok: true });
    } catch (err) {
        return c.json({ ok: false, error: (err as Error).message }, 500);
    }
});

app.get('/api/whatsapp/chats', async (c) => {
    try {
        const chats = await getWhatsAppService().getChats();
        return c.json({ ok: true, chats });
    } catch (err) {
        return c.json({ ok: false, error: (err as Error).message }, 500);
    }
});

app.get('/api/whatsapp/allowed-chat', (c) => {
    const allowed_chat = getSettings().whatsapp?.allowed_chat ?? null;
    return c.json({ ok: true, allowed_chat });
});

app.post('/api/whatsapp/allowed-chat', async (c) => {
    try {
        const body = await c.req.json() as { allowed_chat: string | null };
        const settings = getSettings();
        const next: Settings = {
            ...settings,
            whatsapp: { ...(settings.whatsapp || {}), allowed_chat: body.allowed_chat || null },
        };
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2) + '\n');
        log('INFO', `[API] WhatsApp allowed_chat set to ${body.allowed_chat || '(none)'}`);
        return c.json({ ok: true, allowed_chat: next.whatsapp?.allowed_chat ?? null });
    } catch (err) {
        return c.json({ ok: false, error: (err as Error).message }, 500);
    }
});

export default app;
