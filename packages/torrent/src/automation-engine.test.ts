import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

vi.mock('@fonte/core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@fonte/core')>();
    return { ...actual, enqueueMessage: vi.fn() };
});

// FONTE_HOME resolves once at import time; core's log() needs logs/ to exist.
let tmpHome: string;
let tdb: typeof import('./torrent-db');
let adb: typeof import('./automation-db');
let conn: typeof import('./db-connection');
let engine: import('./automation-engine').AutomationEngine;

const events: { type: string; data: Record<string, unknown> }[] = [];
const eventsOf = (type: string) => events.filter(e => e.type === type);

beforeAll(async () => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fonte-automation-engine-test-'));
    fs.mkdirSync(path.join(tmpHome, 'logs'), { recursive: true });
    process.env.FONTE_HOME = tmpHome;

    tdb = await import('./torrent-db');
    adb = await import('./automation-db');
    conn = await import('./db-connection');
    const { AutomationEngine } = await import('./automation-engine');
    tdb.initTorrentDb();

    const core = await import('@fonte/core');
    core.onEvent((type, data) => { events.push({ type, data }); });

    engine = new AutomationEngine();
    engine.start();
});

afterAll(() => {
    engine.stop();
    tdb.closeTorrentDb();
    delete process.env.FONTE_HOME;
    fs.rmSync(tmpHome, { recursive: true, force: true });
});

beforeEach(() => {
    conn.getDb().exec('DELETE FROM automation_logs; DELETE FROM automation_rules;');
    adb.insertAutomationRule({ id: 'seed', name: 'seed', prompt: 'p', triggerType: 'schedule' });
    adb.deleteAutomationRule('seed');
    events.length = 0;
});

describe('AutomationEngine.evaluateEvent', () => {
    it('runs a rule whose trigger type matches', async () => {
        adb.insertAutomationRule({
            id: 'r1', name: 'On complete', prompt: 'organize it', triggerType: 'torrent:completed',
        });

        await engine.evaluateEvent('torrent:completed', { id: 'tor_1', name: 'Some.Release' });

        const executed = eventsOf('automation:executed');
        expect(executed).toHaveLength(1);
        expect(executed[0].data).toMatchObject({
            ruleId: 'r1', ruleName: 'On complete', triggerEvent: 'torrent:completed',
        });
        expect(adb.getAutomationRule('r1')?.triggerCount).toBe(1);
    });

    it('ignores an event type no enabled rule listens for', async () => {
        adb.insertAutomationRule({
            id: 'r1', name: 'On complete', prompt: 'organize it', triggerType: 'torrent:completed',
        });

        await engine.evaluateEvent('torrent:stats', { downloadSpeed: 0, uploadSpeed: 0 });

        expect(eventsOf('automation:executed')).toHaveLength(0);
    });

    it('ignores events once the matching rule is disabled', async () => {
        adb.insertAutomationRule({
            id: 'r1', name: 'On complete', prompt: 'organize it', triggerType: 'torrent:completed',
        });
        adb.updateAutomationRule('r1', { enabled: false });

        await engine.evaluateEvent('torrent:completed', { id: 'tor_1', name: 'Some.Release' });

        expect(eventsOf('automation:executed')).toHaveLength(0);
    });
});
