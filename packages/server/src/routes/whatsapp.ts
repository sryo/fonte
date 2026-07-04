import fs from 'fs';
import { Hono } from 'hono';
import { getWhatsAppService } from '@fonte/torrent';
import { getSettings, SETTINGS_FILE, log } from '@fonte/core';
import type { Settings } from '@fonte/core';
import { ok, fail } from '../http';

const app = new Hono();

app.post('/api/whatsapp/start', async (c) => {
    try {
        const service = getWhatsAppService();
        await service.start();
        return ok(c, { status: service.status });
    } catch (err) {
        return fail(c, (err as Error).message, 500);
    }
});

app.get('/api/whatsapp/status', (c) => {
    const service = getWhatsAppService();
    return ok(c, service.getStatusInfo());
});

app.get('/api/whatsapp/qr', (c) => {
    const service = getWhatsAppService();
    const qr = service.qr;
    if (!qr) return fail(c, 'No QR available', 404);
    return ok(c, { qr });
});

app.post('/api/whatsapp/disconnect', async (c) => {
    try {
        await getWhatsAppService().stop();
        return ok(c);
    } catch (err) {
        return fail(c, (err as Error).message, 500);
    }
});

app.post('/api/whatsapp/pair', async (c) => {
    try {
        const body = await c.req.json() as { phone: string };
        if (!body.phone) return fail(c, 'phone is required');
        const service = getWhatsAppService();
        if (service.status === 'disconnected') await service.start();
        const code = await service.requestPairingCode(body.phone);
        return ok(c, { code });
    } catch (err) {
        return fail(c, (err as Error).message, 500);
    }
});

app.get('/api/whatsapp/chats', async (c) => {
    try {
        const chats = await getWhatsAppService().getChats();
        return ok(c, { chats });
    } catch (err) {
        return fail(c, (err as Error).message, 500);
    }
});

app.get('/api/whatsapp/allowed-chat', (c) => {
    const allowed_chat = getSettings().whatsapp?.allowed_chat ?? null;
    return ok(c, { allowed_chat });
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
        return ok(c, { allowed_chat: next.whatsapp?.allowed_chat ?? null });
    } catch (err) {
        return fail(c, (err as Error).message, 500);
    }
});

export default app;
