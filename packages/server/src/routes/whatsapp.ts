import { Hono } from 'hono';
import { getWhatsAppService } from '@fonte/torrent';
import { getSettings, updateSettingsFile, log } from '@fonte/core';
import { ok, fail } from '../http';

const app = new Hono();

app.post('/api/whatsapp/start', async (c) => {
    try {
        const service = getWhatsAppService();
        await service.start();
        return ok(c, { ...service.getStatusInfo() });
    } catch (err) {
        return fail(c, (err as Error).message, 500);
    }
});

app.get('/api/whatsapp/status', (c) => {
    return ok(c, { ...getWhatsAppService().getStatusInfo() });
});

app.get('/api/whatsapp/qr', (c) => {
    const service = getWhatsAppService();
    const qr = service.qr;
    if (!qr) return fail(c, 'No QR available', 404);
    return ok(c, { qr });
});

// Routine stop: the session survives daemon restarts and reconnects.
app.post('/api/whatsapp/stop', async (c) => {
    try {
        await getWhatsAppService().stop({ logout: false });
        return ok(c);
    } catch (err) {
        return fail(c, (err as Error).message, 500);
    }
});

// Explicit unpair: revokes the linked device server-side and wipes local
// credentials. Routine shutdowns must use /stop so the session survives
// daemon restarts.
app.post('/api/whatsapp/disconnect', async (c) => {
    try {
        await getWhatsAppService().stop({ logout: true });
        return ok(c);
    } catch (err) {
        return fail(c, (err as Error).message, 500);
    }
});

app.post('/api/whatsapp/pair', async (c) => {
    try {
        const body = await c.req.json() as { phone?: unknown };
        if (typeof body.phone !== 'string' || !/\d/.test(body.phone)) return fail(c, 'Enter a phone number with country code');
        const service = getWhatsAppService();
        if (service.linked) return fail(c, 'This device is already linked to WhatsApp', 409);
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
        const body = await c.req.json() as { allowed_chat?: unknown };
        if (body.allowed_chat != null && typeof body.allowed_chat !== 'string') {
            return fail(c, 'allowed_chat must be a chat id or null');
        }
        const allowedChat = body.allowed_chat || null;
        const next = await updateSettingsFile((settings) => ({
            ...settings,
            whatsapp: { ...(settings.whatsapp || {}), allowed_chat: allowedChat },
        }));
        log('INFO', `[API] WhatsApp allowed_chat set to ${allowedChat || '(none)'}`);
        return ok(c, { allowed_chat: next.whatsapp?.allowed_chat ?? null });
    } catch (err) {
        return fail(c, (err as Error).message, 500);
    }
});

export default app;
