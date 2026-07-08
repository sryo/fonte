import fs from 'fs';
import { Hono } from 'hono';
import { LOG_FILE } from '@fonte/core';
import { ok } from '../http';

const app = new Hono();

app.get('/api/logs', (c) => {
    const limit = parseInt(c.req.query('limit') || '100', 10);
    try {
        const logContent = fs.readFileSync(LOG_FILE, 'utf8');
        const lines = logContent.trim().split('\n').slice(-limit);
        return ok(c, { lines });
    } catch {
        return ok(c, { lines: [] });
    }
});

export default app;
