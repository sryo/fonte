import { Hono } from 'hono';
import { log } from '@fonte/core';

export interface ServiceHandlers {
    restart?: () => void;
}

export function createServicesRoutes(handlers?: ServiceHandlers): Hono {
    const app = new Hono();

    // POST /api/services/restart — restart the process (exit code 75 triggers entrypoint loop)
    app.post('/api/services/restart', (c) => {
        if (!handlers?.restart) {
            return c.json({ ok: false, error: 'Restart not available' }, 501);
        }
        // Respond before exiting so the client gets a response
        const response = c.json({ ok: true, action: 'restart' });
        setTimeout(() => handlers!.restart!(), 100);
        return response;
    });

    return app;
}
