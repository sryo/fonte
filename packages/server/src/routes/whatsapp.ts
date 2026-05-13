import { Hono } from 'hono';
import { getWhatsAppService } from '@aitorrent/torrent';

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

export default app;
