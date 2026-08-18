import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

// LOG_FILE derives from FONTE_HOME, which @fonte/core resolves once at import
// time, so the temp home must be set before the first dynamic import. The route
// module's default export is a self-contained Hono app.
let tmpHome: string;
let app: (typeof import('./logs'))['default'];
let logFile: string;

beforeAll(async () => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fonte-logs-route-test-'));
    fs.mkdirSync(path.join(tmpHome, 'logs'), { recursive: true });
    process.env.FONTE_HOME = tmpHome;
    app = (await import('./logs')).default;
    logFile = path.join(tmpHome, 'logs', 'queue.log');
});

afterAll(() => {
    delete process.env.FONTE_HOME;
    fs.rmSync(tmpHome, { recursive: true, force: true });
});

beforeEach(() => {
    fs.rmSync(logFile, { force: true });
});

async function getLines(query = ''): Promise<string[]> {
    const res = await app.request(`/api/logs${query}`);
    const body = await res.json() as { ok: boolean; lines: string[] };
    expect(body.ok).toBe(true);
    return body.lines;
}

describe('GET /api/logs', () => {
    it('returns the last N lines', async () => {
        fs.writeFileSync(logFile, Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n') + '\n');
        const lines = await getLines('?limit=10');
        expect(lines).toHaveLength(10);
        expect(lines[0]).toBe('line 40');
        expect(lines[9]).toBe('line 49');
    });

    it('returns every line when the file is shorter than the limit', async () => {
        fs.writeFileSync(logFile, 'only one\n');
        expect(await getLines('?limit=100')).toEqual(['only one']);
    });

    it('reads only whole lines from a file larger than the tail window', async () => {
        const filler = Array.from({ length: 20_000 }, (_, i) => `filler line ${i} ${'p'.repeat(40)}`);
        fs.writeFileSync(logFile, filler.join('\n') + '\ntail marker\n');
        expect(fs.statSync(logFile).size).toBeGreaterThan(256 * 1024);

        const lines = await getLines('?limit=500');
        expect(lines[lines.length - 1]).toBe('tail marker');
        expect(lines).toHaveLength(500);
        // The window cut mid-line; that partial must be dropped, not served.
        for (const line of lines) expect(line).toMatch(/^(filler line \d+ p+|tail marker)$/);
    });

    it('returns an empty list when the log file is missing', async () => {
        expect(await getLines()).toEqual([]);
    });

    it('falls back to the default limit for a non-numeric value', async () => {
        fs.writeFileSync(logFile, Array.from({ length: 150 }, (_, i) => `line ${i}`).join('\n') + '\n');
        expect(await getLines('?limit=garbage')).toHaveLength(100);
    });
});
