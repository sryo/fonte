import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { describe, it, expect, afterEach } from 'vitest';
import { acquireInstanceLock, releaseInstanceLock } from './instance-lock';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fonte-lock-test-'));
const lockFile = path.join(dir, 'daemon.lock');

function tryFromAnotherProcess(): string {
    const script = `
        const Database = require(${JSON.stringify(require.resolve('better-sqlite3'))});
        const db = new Database(${JSON.stringify(lockFile)});
        db.pragma('busy_timeout = 0');
        try { db.exec('BEGIN EXCLUSIVE'); process.stdout.write('acquired'); }
        catch (e) { process.stdout.write(e.code); }
    `;
    return execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' });
}

afterEach(() => releaseInstanceLock());

describe('acquireInstanceLock', () => {
    it('keeps a second process out while held', () => {
        expect(acquireInstanceLock(lockFile)).toBe(true);
        expect(tryFromAnotherProcess()).toBe('SQLITE_BUSY');
    });

    it('frees the lock on release', () => {
        expect(acquireInstanceLock(lockFile)).toBe(true);
        releaseInstanceLock();
        expect(tryFromAnotherProcess()).toBe('acquired');
    });
});
