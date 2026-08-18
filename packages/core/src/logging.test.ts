import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// LOG_FILE derives from FONTE_HOME, resolved once at import time — one temp
// home for the file, set before the first dynamic import. log() tracks the log
// size in-process, so each test re-imports to simulate a freshly booted daemon.
let tmpHome: string;
let logFile: string;

beforeAll(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fonte-logging-test-'));
    fs.mkdirSync(path.join(tmpHome, 'logs'), { recursive: true });
    process.env.FONTE_HOME = tmpHome;
    logFile = path.join(tmpHome, 'logs', 'queue.log');
});

afterAll(() => {
    delete process.env.FONTE_HOME;
    fs.rmSync(tmpHome, { recursive: true, force: true });
});

beforeEach(() => {
    fs.rmSync(logFile, { force: true });
    fs.rmSync(`${logFile}.1`, { force: true });
    vi.resetModules();
});

async function freshLog(): Promise<typeof import('./logging').log> {
    return (await import('./logging')).log;
}

const OVER_LIMIT = 'x'.repeat(5 * 1024 * 1024 + 1);

describe('log', () => {
    it('appends a timestamped, levelled line', async () => {
        const log = await freshLog();
        log('INFO', 'hello');
        expect(fs.readFileSync(logFile, 'utf8').trim())
            .toMatch(/^\[\d{4}-\d{2}-\d{2}T[\d:.]+Z\] \[INFO\] hello$/);
    });

    it('leaves a small log unrotated', async () => {
        const log = await freshLog();
        log('INFO', 'first');
        log('INFO', 'second');
        expect(fs.existsSync(`${logFile}.1`)).toBe(false);
        expect(fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean)).toHaveLength(2);
    });

    it('rotates a log past the size limit, keeping the old content in .1', async () => {
        fs.writeFileSync(logFile, OVER_LIMIT);
        const log = await freshLog();
        log('WARN', 'after rotation');

        expect(fs.statSync(`${logFile}.1`).size).toBe(OVER_LIMIT.length);
        const current = fs.readFileSync(logFile, 'utf8');
        expect(current).toContain('after rotation');
        expect(current.split('\n').filter(Boolean)).toHaveLength(1);
    });

    it('rotates once the running size crosses the limit mid-process', async () => {
        const log = await freshLog();
        log('INFO', 'a'.repeat(3 * 1024 * 1024));
        expect(fs.existsSync(`${logFile}.1`)).toBe(false);

        log('INFO', 'b'.repeat(3 * 1024 * 1024));
        expect(fs.existsSync(`${logFile}.1`)).toBe(true);
        expect(fs.readFileSync(logFile, 'utf8')).toContain('b'.repeat(100));
    });

    it('overwrites a previous rotated generation', async () => {
        fs.writeFileSync(`${logFile}.1`, 'older generation');
        fs.writeFileSync(logFile, OVER_LIMIT);
        const log = await freshLog();
        log('WARN', 'newest');

        expect(fs.readFileSync(`${logFile}.1`, 'utf8')).not.toContain('older generation');
        expect(fs.readFileSync(logFile, 'utf8')).toContain('newest');
    });
});
