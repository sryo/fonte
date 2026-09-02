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
    conn.getDb().exec('DELETE FROM automation_runs; DELETE FROM automation_rules;');
    // The cache is invalidated by the CRUD helpers, not by a raw table wipe.
    adb.insertAutomationRule({ id: 'seed', name: 'seed', prompt: 'p', trigger: { type: 'cron', schedule: '0 9 * * *' } });
    adb.deleteAutomationRule('seed');
});

const event = (name: string) => ({ type: 'event', event: name });

function addRule(id: string, trigger: unknown, extra: Partial<Parameters<typeof adb.insertAutomationRule>[0]> = {}): void {
    adb.insertAutomationRule({ id, name: `Rule ${id}`, prompt: 'do a thing', trigger, ...extra });
}

describe('rules', () => {
    it('stores a normalized trigger with a description and agent', () => {
        addRule('r1', [event('torrent:completed'), { type: 'cron', schedule: ' 0 8 * * 1-5 ' }], { agentId: 'other' });
        const rule = adb.getAutomationRule('r1')!;
        expect(rule.trigger).toEqual({ type: 'group', members: [event('torrent:completed'), { type: 'cron', schedule: '0 8 * * 1-5' }] });
        expect(rule.triggerDescription).toBe('When a torrent completes or weekdays at 8:00 AM');
        expect(rule.agentId).toBe('other');
        expect(rule.nextRunAt).toBeGreaterThan(Date.now());
    });

    it('defaults the agent and rejects an invalid trigger', () => {
        addRule('r1', event('watchlist:match'));
        expect(adb.getAutomationRule('r1')!.agentId).toBe('fonte');
        expect(() => addRule('r2', { type: 'event', event: 'nope' })).toThrow(/trigger is invalid/);
        expect(() => adb.updateAutomationRule('r1', { trigger: { type: 'cron', schedule: 'bad' } })).toThrow(/trigger is invalid/);
    });

    it('filters by agent and by event', () => {
        addRule('r1', event('torrent:completed'));
        addRule('r2', [event('torrent:completed'), event('torrent:error')], { agentId: 'other' });
        addRule('r3', { type: 'cron', schedule: '0 9 * * *' });
        expect(adb.getAutomationRules({ event: 'torrent:completed' }).map(r => r.id).sort()).toEqual(['r1', 'r2']);
        expect(adb.getAutomationRules({ agentId: 'other' }).map(r => r.id)).toEqual(['r2']);
        expect(adb.getAutomationRules({ event: 'torrent:error', enabled: true }).map(r => r.id)).toEqual(['r2']);
    });

    it('has no next run while disabled', () => {
        addRule('r1', { type: 'cron', schedule: '0 9 * * *' });
        adb.updateAutomationRule('r1', { enabled: false });
        expect(adb.getAutomationRule('r1')!.nextRunAt).toBeNull();
    });
});

describe('getEnabledEventIndex', () => {
    it('is empty with no rules', () => {
        expect(adb.getEnabledEventIndex().size).toBe(0);
    });

    it('lists rule ids per event, including group members', () => {
        addRule('r1', event('torrent:completed'));
        addRule('r2', [event('torrent:completed'), event('watchlist:match')]);
        const index = adb.getEnabledEventIndex();
        expect(index.get('torrent:completed')!.sort()).toEqual(['r1', 'r2']);
        expect(index.get('watchlist:match')).toEqual(['r2']);
    });

    it('drops an event when its only rule is disabled, and restores it on re-enable', () => {
        addRule('r1', event('torrent:completed'));
        adb.updateAutomationRule('r1', { enabled: false });
        expect(adb.getEnabledEventIndex().has('torrent:completed')).toBe(false);

        adb.updateAutomationRule('r1', { enabled: true });
        expect(adb.getEnabledEventIndex().has('torrent:completed')).toBe(true);
    });

    it('follows a changed trigger', () => {
        addRule('r1', event('torrent:added'));
        adb.updateAutomationRule('r1', { trigger: event('torrent:stalled') });
        expect([...adb.getEnabledEventIndex().keys()]).toEqual(['torrent:stalled']);
    });

    it('drops an event when its rule is deleted', () => {
        addRule('r1', event('torrent:completed'));
        adb.deleteAutomationRule('r1');
        expect(adb.getEnabledEventIndex().size).toBe(0);
    });

    it('survives the engine bumping triggerCount', () => {
        addRule('r1', event('torrent:completed'));
        adb.updateAutomationRule('r1', { triggerCount: 5, lastTriggeredAt: Date.now() });
        expect(adb.getEnabledEventIndex().has('torrent:completed')).toBe(true);
    });

    it('notifies listeners on definition changes only', () => {
        let calls = 0;
        const off = adb.onAutomationRulesChanged(() => { calls += 1; });
        addRule('r1', event('torrent:completed'));
        adb.updateAutomationRule('r1', { triggerCount: 1 });
        adb.updateAutomationRule('r1', { prompt: 'changed' });
        off();
        adb.deleteAutomationRule('r1');
        expect(calls).toBe(2);
    });
});

describe('runs', () => {
    it('records a run from running to finished and keeps the newest 20', () => {
        addRule('r1', event('torrent:completed'));
        for (let i = 0; i < 25; i++) {
            adb.beginAutomationRun({ id: `run${i}`, ruleId: 'r1', trigger: 'event', messageId: `auto_r1_run${i}`, eventSummary: `event ${i}` });
        }
        const runs = adb.getAutomationRuns('r1');
        expect(runs).toHaveLength(20);
        expect(runs[0].status).toBe('running');
        expect(adb.getAutomationRun('run0')).toBeUndefined();

        adb.finishAutomationRun('run24', 'ok', 'All done');
        const done = adb.getAutomationRun('run24')!;
        expect(done.status).toBe('ok');
        expect(done.detail).toBe('All done');
        expect(done.finishedAt).not.toBeNull();
        expect(adb.getAutomationRunByMessageId('auto_r1_run24')!.id).toBe('run24');
    });

    it('does not re-finish a settled run, and finds the running one', () => {
        addRule('r1', event('torrent:completed'));
        adb.beginAutomationRun({ id: 'a', ruleId: 'r1', trigger: 'schedule', messageId: 'auto_r1_a' });
        expect(adb.getRunningAutomationRun('r1')!.id).toBe('a');
        adb.finishAutomationRun('a', 'error', 'boom');
        adb.finishAutomationRun('a', 'ok', 'late');
        expect(adb.getAutomationRun('a')!.status).toBe('error');
        expect(adb.getRunningAutomationRun('r1')).toBeUndefined();
    });

    it('clamps details and stores skipped runs as already finished', () => {
        addRule('r1', event('torrent:completed'));
        const run = adb.beginAutomationRun({
            id: 's', ruleId: 'r1', trigger: 'manual', messageId: 'skipped_s', status: 'skipped', detail: 'x'.repeat(500),
        });
        expect(run.status).toBe('skipped');
        expect(run.finishedAt).not.toBeNull();
        expect(run.detail).toHaveLength(300);
    });
});

describe('migrations', () => {
    it('backfills triggers from the legacy columns', () => {
        const db = conn.getDb();
        const now = Date.now();
        db.prepare(`INSERT INTO automation_rules (id, name, prompt, trigger_type, trigger_config, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`)
            .run('legacy1', 'On complete', 'p', 'torrent:completed', '{}', now, now);
        db.prepare(`INSERT INTO automation_rules (id, name, prompt, trigger_type, trigger_config, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`)
            .run('legacy2', 'Nightly', 'p', 'schedule', '{"cron":"0 3 * * *"}', now, now);
        db.prepare(`INSERT INTO automation_rules (id, name, prompt, trigger_type, trigger_config, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`)
            .run('legacy3', 'Broken', 'p', 'schedule', '{}', now, now);

        adb.backfillLegacyTriggers();

        expect(adb.getAutomationRule('legacy1')!.trigger).toEqual(event('torrent:completed'));
        expect(adb.getAutomationRule('legacy2')!.trigger).toEqual({ type: 'cron', schedule: '0 3 * * *' });
        const broken = adb.getAutomationRule('legacy3')!;
        expect(broken.enabled).toBe(false);
        expect(broken.trigger.type).toBe('cron');
    });

    it('imports schedules.json once and renames it', () => {
        const file = path.join(tmpHome, 'schedules.json');
        fs.writeFileSync(file, JSON.stringify([
            { id: 'abc', label: 'Morning check', cron: '0 8 * * 1-5', agentId: 'fonte', message: 'Check the watchlist', enabled: true, createdAt: 1000 },
            { id: 'def', label: 'Once', runAt: '2030-05-01T09:00:00.000Z', agentId: 'fonte', message: 'Remind me', enabled: true },
            { id: 'bad', label: 'No message', cron: '0 8 * * *', agentId: 'fonte' },
        ]));

        expect(adb.importLegacySchedules(file)).toBe(2);
        expect(fs.existsSync(file)).toBe(false);
        expect(fs.existsSync(`${file}.imported`)).toBe(true);

        const morning = adb.getAutomationRule('auto_sched_abc')!;
        expect(morning.name).toBe('Morning check');
        expect(morning.prompt).toBe('Check the watchlist');
        expect(morning.trigger).toEqual({ type: 'cron', schedule: '0 8 * * 1-5' });
        expect(morning.createdAt).toBe(1000);
        expect(adb.getAutomationRule('auto_sched_def')!.trigger.type).toBe('once');

        expect(adb.importLegacySchedules(file)).toBe(0);
    });
});
