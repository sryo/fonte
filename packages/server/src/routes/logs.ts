import fs from 'fs';
import { Hono } from 'hono';
import { LOG_FILE } from '@fonte/core';
import { ok } from '../http';

const app = new Hono();

const TAIL_BYTES = 256 * 1024;

function tailLines(limit: number): string[] {
    const fd = fs.openSync(LOG_FILE, 'r');
    try {
        const { size } = fs.fstatSync(fd);
        const len = Math.min(size, TAIL_BYTES);
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, size - len);
        let text = buf.toString('utf8');
        if (len < size) text = text.slice(text.indexOf('\n') + 1);
        return text.trim().split('\n').filter(Boolean).slice(-limit);
    } finally {
        fs.closeSync(fd);
    }
}

app.get('/api/logs', (c) => {
    const parsed = parseInt(c.req.query('limit') || '100', 10);
    const limit = Number.isFinite(parsed) && parsed > 0 ? parsed : 100;
    try {
        return ok(c, { lines: tailLines(limit) });
    } catch {
        return ok(c, { lines: [] });
    }
});

export default app;
