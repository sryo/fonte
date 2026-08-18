import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

// Same single-temp-home setup as torrent-db.test.ts: FONTE_HOME resolves once
// at import time, so it must be set before the first dynamic import.
let tmpHome: string;
let tdb: typeof import('./torrent-db');
let adb: typeof import('./automation-db');
let conn: typeof import('./db-connection');

beforeAll(async () => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fonte-automation-db-test-'));
    process.env.FONTE_HOME = tmpHome;
    tdb = await import('./torrent-db');
    adb = await import('./automation-db');
    conn = await import('./db-connection');
    tdb.initTorrentDb();
});

afterAll(() => {
    tdb.closeTorrentDb();
    delete process.env.FONTE_HOME;
    fs.rmSync(tmpHome, { recursive: true, force: true });
});

beforeEach(() => {
    conn.getDb().exec('DELETE FROM automation_logs; DELETE FROM automation_rules;');
    // The cache is invalidated by the CRUD helpers, not by a raw table wipe.
    adb.insertAutomationRule({ id: 'seed', name: 'seed', prompt: 'p', triggerType: 'schedule' });
    adb.deleteAutomationRule('seed');
});

function addRule(id: string, triggerType: Parameters<typeof adb.insertAutomationRule>[0]['triggerType']): void {
    adb.insertAutomationRule({ id, name: `Rule ${id}`, prompt: 'do a thing', triggerType });
}

describe('getEnabledTriggerTypes', () => {
    it('is empty with no rules', () => {
        expect(adb.getEnabledTriggerTypes().size).toBe(0);
    });

    it('reflects inserted rules', () => {
        addRule('r1', 'torrent:completed');
        addRule('r2', 'watchlist:match');
        expect([...adb.getEnabledTriggerTypes()].sort()).toEqual(['torrent:completed', 'watchlist:match']);
    });

    it('drops a type when its only rule is disabled, and restores it on re-enable', () => {
        addRule('r1', 'torrent:completed');
        adb.updateAutomationRule('r1', { enabled: false });
        expect(adb.getEnabledTriggerTypes().has('torrent:completed')).toBe(false);

        adb.updateAutomationRule('r1', { enabled: true });
        expect(adb.getEnabledTriggerTypes().has('torrent:completed')).toBe(true);
    });

    it('follows a changed trigger type', () => {
        addRule('r1', 'torrent:added');
        adb.updateAutomationRule('r1', { triggerType: 'torrent:stalled' });
        expect([...adb.getEnabledTriggerTypes()]).toEqual(['torrent:stalled']);
    });

    it('keeps a type while another enabled rule still uses it', () => {
        addRule('r1', 'torrent:completed');
        addRule('r2', 'torrent:completed');
        adb.updateAutomationRule('r1', { enabled: false });
        expect(adb.getEnabledTriggerTypes().has('torrent:completed')).toBe(true);
    });

    it('drops a type when its rule is deleted', () => {
        addRule('r1', 'torrent:completed');
        adb.deleteAutomationRule('r1');
        expect(adb.getEnabledTriggerTypes().size).toBe(0);
    });

    it('survives the engine bumping triggerCount', () => {
        addRule('r1', 'torrent:completed');
        adb.updateAutomationRule('r1', { triggerCount: 5, lastTriggeredAt: Date.now() });
        expect(adb.getEnabledTriggerTypes().has('torrent:completed')).toBe(true);
    });
});
