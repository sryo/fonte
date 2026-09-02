import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

const enqueued: any[] = [];
const agentRows: any[] = [];
vi.mock('@fonte/core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@fonte/core')>();
    return {
        ...actual,
        enqueueMessage: vi.fn((data: any) => { enqueued.push(data); return enqueued.length; }),
        insertAgentMessage: vi.fn((row: any) => { agentRows.push(row); return agentRows.length; }),
    };
});

// FONTE_HOME resolves once at import time; core's log() needs logs/ to exist.
let tmpHome: string;
let tdb: typeof import('./torrent-db');
let adb: typeof import('./automation-db');
let conn: typeof import('./db-connection');
let core: typeof import('@fonte/core');
let AutomationEngine: typeof import('./automation-engine').AutomationEngine;
let engine: import('./automation-engine').AutomationEngine;

const events: { type: string; data: Record<string, unknown> }[] = [];
const eventsOf = (type: string) => events.filter(e => e.type === type);
const event = (name: string) => ({ type: 'event', event: name });
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

beforeAll(async () => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fonte-automation-engine-test-'));
    fs.mkdirSync(path.join(tmpHome, 'logs'), { recursive: true });
    process.env.FONTE_HOME = tmpHome;

    tdb = await import('./torrent-db');
    adb = await import('./automation-db');
    conn = await import('./db-connection');
    ({ AutomationEngine } = await import('./automation-engine'));
    tdb.initTorrentDb();

    core = await import('@fonte/core');
    core.onEvent((type, data) => { events.push({ type, data }); });

    engine = new AutomationEngine({ eventDebounceMs: 0 });
    engine.start();
});

afterAll(() => {
    engine.stop();
    tdb.closeTorrentDb();
    delete process.env.FONTE_HOME;
    fs.rmSync(tmpHome, { recursive: true, force: true });
});

beforeEach(() => {
    conn.getDb().exec('DELETE FROM automation_runs; DELETE FROM automation_rules;');
    adb.insertAutomationRule({ id: 'seed', name: 'seed', prompt: 'p', trigger: event('torrent:added') });
    adb.deleteAutomationRule('seed');
    events.length = 0;
    enqueued.length = 0;
    agentRows.length = 0;
});

describe('AutomationEngine.evaluateEvent', () => {
    it('runs a rule whose trigger matches and records a running run', async () => {
        adb.insertAutomationRule({ id: 'r1', name: 'On complete', prompt: 'organize it', trigger: event('torrent:completed') });

        await engine.evaluateEvent('torrent:completed', { id: 'tor_1', name: 'Some.Release' });

        const executed = eventsOf('automation:executed');
        expect(executed).toHaveLength(1);
        expect(executed[0].data).toMatchObject({ ruleId: 'r1', ruleName: 'On complete', triggerEvent: 'torrent:completed', trigger: 'event' });
        expect(adb.getAutomationRule('r1')?.triggerCount).toBe(1);

        expect(enqueued).toHaveLength(1);
        expect(enqueued[0]).toMatchObject({ channel: 'automation', agent: 'fonte', lane: 'background' });
        expect(enqueued[0].messageId).toMatch(/^auto_r1_run_/);
        expect(enqueued[0].message).toContain('[automation] "On complete"');
        expect(enqueued[0].message).toContain('organize it');
        expect(enqueued[0].message).toContain('<torrent_event>');

        const runs = adb.getAutomationRuns('r1');
        expect(runs).toHaveLength(1);
        expect(runs[0]).toMatchObject({ status: 'running', trigger: 'event', messageId: enqueued[0].messageId });
        expect(runs[0].eventSummary).toBe('torrent "Some.Release" completed');

        expect(agentRows).toHaveLength(1);
        expect(agentRows[0]).toMatchObject({ agentId: 'fonte', role: 'user', kind: 'event' });
        expect(JSON.parse(agentRows[0].content)).toMatchObject({ event: 'automation-fired', ruleId: 'r1', ruleName: 'On complete' });
    });

    it('ignores an event type no enabled rule listens for', async () => {
        adb.insertAutomationRule({ id: 'r1', name: 'On complete', prompt: 'organize it', trigger: event('torrent:completed') });

        await engine.evaluateEvent('torrent:stats', { downloadSpeed: 0, uploadSpeed: 0 });

        expect(eventsOf('automation:executed')).toHaveLength(0);
    });

    it('ignores events once the matching rule is disabled', async () => {
        adb.insertAutomationRule({ id: 'r1', name: 'On complete', prompt: 'organize it', trigger: event('torrent:completed') });
        adb.updateAutomationRule('r1', { enabled: false });

        await engine.evaluateEvent('torrent:completed', { id: 'tor_1', name: 'Some.Release' });

        expect(eventsOf('automation:executed')).toHaveLength(0);
    });

    it('routes to the rule agent and matches group members', async () => {
        adb.insertAutomationRule({
            id: 'r1', name: 'Either', prompt: 'p', agentId: 'other',
            trigger: [event('torrent:error'), event('torrent:stalled')],
        });

        await engine.evaluateEvent('torrent:stalled', { id: 'tor_1', name: 'X', minutesStalled: 5 });

        expect(enqueued).toHaveLength(1);
        expect(enqueued[0].agent).toBe('other');
    });

    it('batches a burst of events into one wake', async () => {
        const batching = new AutomationEngine({ eventDebounceMs: 30 });
        batching.start();
        try {
            adb.insertAutomationRule({ id: 'r1', name: 'Results', prompt: 'p', trigger: event('watchlist:results') });
            await Promise.all([
                batching.evaluateEvent('watchlist:results', { title: 'A', count: 1 }),
                batching.evaluateEvent('watchlist:results', { title: 'B', count: 2 }),
                batching.evaluateEvent('watchlist:results', { title: 'C', count: 3 }),
            ]);
        } finally {
            batching.stop();
        }

        // Both engines listen on the bus, but only the batching one was asked directly.
        expect(enqueued).toHaveLength(1);
        expect(enqueued[0].message).toContain('3 events, latest: watchlist entry "C" has 3 new results');
        expect((enqueued[0].message.match(/<watchlist_event>/g) ?? []).length).toBe(3);
        expect(adb.getAutomationRuns('r1')[0].eventSummary).toBe('3 events, latest: watchlist entry "C" has 3 new results');
    });
});

describe('AutomationEngine.fire', () => {
    it('skips a scheduled fire while the previous run is still running', async () => {
        adb.insertAutomationRule({ id: 'r1', name: 'Hourly', prompt: 'p', trigger: { type: 'cron', schedule: '0 * * * *' } });
        const rule = adb.getAutomationRule('r1')!;

        expect(await engine.fire(rule, { trigger: 'schedule' })).toBe('ok');
        expect(await engine.fire(rule, { trigger: 'schedule' })).toBe('skipped');

        const runs = adb.getAutomationRuns('r1');
        expect(runs.map(r => r.status)).toEqual(['skipped', 'running']);
        expect(runs[0].detail).toBe('Previous run still in progress');
        expect(enqueued).toHaveLength(1);
        expect(enqueued[0].message).toContain('is due');
    });

    it('describes a manual run as on demand', async () => {
        adb.insertAutomationRule({ id: 'r1', name: 'Manual', prompt: 'p', trigger: event('torrent:completed') });
        await engine.fire(adb.getAutomationRule('r1')!, { trigger: 'manual' });
        expect(enqueued[0].message).toContain('was run on demand');
        expect(adb.getAutomationRuns('r1')[0].trigger).toBe('manual');
    });

    it('disables a one-time rule after it fires on schedule', async () => {
        const runAt = new Date(Date.now() + 60_000).toISOString();
        adb.insertAutomationRule({ id: 'r1', name: 'Once', prompt: 'p', trigger: { type: 'once', runAt } });
        expect(engine.scheduledRuleIds()).toContain('r1');
        await engine.fire(adb.getAutomationRule('r1')!, { trigger: 'schedule' });
        expect(adb.getAutomationRule('r1')!.enabled).toBe(false);
        expect(engine.scheduledRuleIds()).not.toContain('r1');
    });
});

describe('run outcomes', () => {
    async function fireOnce(): Promise<string> {
        adb.insertAutomationRule({ id: 'r1', name: 'On complete', prompt: 'p', trigger: event('torrent:completed') });
        await engine.evaluateEvent('torrent:completed', { id: 'tor_1', name: 'X' });
        return enqueued[0].messageId as string;
    }

    it('closes the run as ok with a reply excerpt', async () => {
        const messageId = await fireOnce();
        core.emitEvent('agent:response', { agentId: 'fonte', messageId, content: 'Moved  the file\nto Movies.' });
        await tick();
        const run = adb.getAutomationRuns('r1')[0];
        expect(run.status).toBe('ok');
        expect(run.detail).toBe('Moved the file to Movies.');
        expect(eventsOf('automation:finished')[0].data).toMatchObject({ ruleId: 'r1', status: 'ok' });
    });

    it('records a quiet reply as nothing to report', async () => {
        const messageId = await fireOnce();
        core.emitEvent('agent:response', { agentId: 'fonte', messageId, content: '[quiet]', quiet: true });
        await tick();
        expect(adb.getAutomationRuns('r1')[0].detail).toBe('Nothing to report');
    });

    it('closes the run as interrupted on cancel', async () => {
        const messageId = await fireOnce();
        core.emitEvent('agent:cancelled', { agentId: 'fonte', messageId });
        await tick();
        expect(adb.getAutomationRuns('r1')[0].status).toBe('interrupted');
    });

    it('closes the run as error and notifies on the 1st, 2nd, 4th occurrence', async () => {
        adb.insertAutomationRule({ id: 'r1', name: 'On complete', prompt: 'p', trigger: event('torrent:completed') });
        const notified: boolean[] = [];
        for (let i = 0; i < 5; i++) {
            enqueued.length = 0;
            await engine.evaluateEvent('torrent:completed', { id: `tor_${i}`, name: 'X' });
            core.emitEvent('agent:error', { agentId: 'fonte', messageId: enqueued[0].messageId, error: `Claude exited with code ${i + 1}` });
            await tick();
            const failed = eventsOf('automation:failed');
            notified.push(failed[failed.length - 1].data.notify as boolean);
        }
        expect(notified).toEqual([true, true, false, true, false]);
        expect(adb.getAutomationRuns('r1')[0]).toMatchObject({ status: 'error', detail: 'Claude exited with code 5' });

        // A success resets the count, so the next failure notifies again.
        enqueued.length = 0;
        await engine.evaluateEvent('torrent:completed', { id: 'tor_ok', name: 'X' });
        core.emitEvent('agent:response', { agentId: 'fonte', messageId: enqueued[0].messageId, content: 'fine' });
        enqueued.length = 0;
        await engine.evaluateEvent('torrent:completed', { id: 'tor_again', name: 'X' });
        core.emitEvent('agent:error', { agentId: 'fonte', messageId: enqueued[0].messageId, error: 'Claude exited with code 9' });
        await tick();
        const failed = eventsOf('automation:failed');
        expect(failed[failed.length - 1].data.notify).toBe(true);
    });

    it('ignores outcome events for messages it did not send', async () => {
        await fireOnce();
        core.emitEvent('agent:response', { agentId: 'fonte', messageId: 'web_123', content: 'hi' });
        await tick();
        expect(adb.getAutomationRuns('r1')[0].status).toBe('running');
    });
});
