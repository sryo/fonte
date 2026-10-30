import { Hono } from 'hono';
import { getSettings, isNotificationDestination, sendMacNotification, sendWhatsAppNotification } from '@fonte/core';
import { ok, fail } from '../http';

const app = new Hono();

// Bypasses the enabled flags so each delivery path can be verified.
app.post('/api/notifications/test', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { destination?: unknown } | null;
    const destination = body?.destination ?? 'mac';
    if (!isNotificationDestination(destination)) {
        return fail(c, 'Destination must be mac, whatsapp, or both.');
    }
    const toMac = destination !== 'whatsapp';
    const toWhatsApp = destination !== 'mac';
    if (toMac && process.platform !== 'darwin') {
        return fail(c, 'Native notifications are only supported on macOS');
    }
    if (toWhatsApp && !getSettings().whatsapp?.allowed_chat) {
        return fail(c, 'Pick a WhatsApp chat first.');
    }
    if (toWhatsApp) sendWhatsAppNotification('Fonte', 'Notifications are working');
    if (toMac) sendMacNotification('Fonte', 'Notifications are working');
    return ok(c);
});

export default app;
