import { Hono } from 'hono';
import { sendMacNotification } from '@fonte/core';
import { ok, fail } from '../http';

const app = new Hono();

// Bypasses the enabled flags so the macOS permission path can be verified.
app.post('/api/notifications/test', (c) => {
    if (process.platform !== 'darwin') {
        return fail(c, 'Native notifications are only supported on macOS');
    }
    sendMacNotification('Fonte', 'Test notification — notifications are working');
    return ok(c);
});

export default app;
