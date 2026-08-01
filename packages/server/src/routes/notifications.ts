import { Hono } from 'hono';
import { sendMacNotification } from '@fonte/core';
import { ok, fail } from '../http';

const app = new Hono();

// Fires regardless of the enabled flags — its purpose is verifying the macOS
// permission/banner path before the user opts in.
app.post('/api/notifications/test', (c) => {
    if (process.platform !== 'darwin') {
        return fail(c, 'Native notifications are only supported on macOS');
    }
    sendMacNotification('Fonte', 'Test notification — notifications are working');
    return ok(c);
});

export default app;
