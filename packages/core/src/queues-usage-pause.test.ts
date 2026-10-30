import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

let tmpHome: string;
let dbPath: string;
let q: typeof import('./queues');

beforeAll(async () => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fonte-queues-pause-test-'));
    fs.mkdirSync(path.join(tmpHome, 'logs'), { recursive: true });
    process.env.FONTE_HOME = tmpHome;
    dbPath = path.join(tmpHome, 'fonte.db');
    q = await import('./queues');
});

afterAll(() => {
    q.closeQueueDb();
    delete process.env.FONTE_HOME;
    fs.rmSync(tmpHome, { recursive: true, force: true });
});

beforeEach(() => {
    for (const f of ['fonte.db', 'fonte.db-wal', 'fonte.db-shm']) fs.rmSync(path.join(tmpHome, f), { force: true });
    fs.rmSync(path.join(tmpHome, 'backups'), { recursive: true, force: true });
    q.initQueueDb();
});

afterEach(() => q.closeQueueDb());

const HOUR = 3_600_000;

function enqueue(messageId: string, opts: { agent?: string; lane?: 'user' | 'background' } = {}): number {
    return q.enqueueMessage({ channel: 'web', sender: 'me', message: messageId, messageId, agent: opts.agent ?? 'a', lane: opts.lane })!;
}

function row(id: number): any {
    q.closeQueueDb();
    const d = new Database(dbPath, { readonly: true });
    try { return d.prepare('SELECT * FROM messages WHERE id=?').get(id); } finally { d.close(); q.initQueueDb(); }
}

function claimAndRun(agent = 'a'): any {
    const msg = q.claimNextPendingMessage(agent);
    q.markProcessing(msg.id);
    return msg;
}

describe('requeueMessageAt', () => {
    it('puts a running row back to pending until the given time without spending a retry', () => {
        const id = enqueue('m1');
        claimAndRun();
        const until = Date.now() + HOUR;
        expect(q.requeueMessageAt(id, until, 'usage limit', { unknownReset: false })).toBe(true);
        expect(row(id)).toMatchObject({ status: 'pending', not_before: until, last_error: 'usage limit', retry_count: 0, unknown_resets: 0 });
        expect(row(id).paused_ms).toBeGreaterThan(HOUR - 5_000);
    });

    it('counts consecutive unknown-reset pauses and adds up the time paused', () => {
        const id = enqueue('m1');
        claimAndRun();
        q.requeueMessageAt(id, Date.now() - 1, 'limit', { unknownReset: true });
        claimAndRun();
        q.requeueMessageAt(id, Date.now() + HOUR, 'limit', { unknownReset: true });
        expect(row(id)).toMatchObject({ unknown_resets: 2 });
        expect(row(id).paused_ms).toBeGreaterThan(HOUR - 5_000);

        q.closeQueueDb();
        const d = new Database(dbPath);
        d.prepare('UPDATE messages SET not_before=NULL WHERE id=?').run(id);
        d.close();
        q.initQueueDb();
        claimAndRun();
        q.requeueMessageAt(id, Date.now() + HOUR, 'limit', { unknownReset: false });
        expect(row(id)).toMatchObject({ unknown_resets: 0 });
    });

    it('leaves a cancelled or settled row alone', () => {
        const id = enqueue('m1');
        claimAndRun();
        q.cancelMessage(id);
        expect(q.requeueMessageAt(id, Date.now() + HOUR, 'limit', { unknownReset: true })).toBe(false);
        expect(row(id).status).toBe('cancelled');
    });

    it('starts a manually retried dead row fresh', () => {
        const id = enqueue('m1');
        claimAndRun();
        q.requeueMessageAt(id, Date.now() - 1, 'limit', { unknownReset: true });
        claimAndRun();
        q.deadLetterMessage(id, 'gave up');
        expect(q.retryDeadMessage(id)).toBe(true);
        expect(row(id)).toMatchObject({ status: 'pending', not_before: null, paused_ms: 0, unknown_resets: 0 });
    });
});

describe('claiming around not_before', () => {
    it('skips a held row and claims the next one, then the held row once its time comes', () => {
        const held = enqueue('held');
        claimAndRun();
        q.requeueMessageAt(held, Date.now() + HOUR, 'limit', { unknownReset: true });
        enqueue('bg', { lane: 'background' });

        expect(q.claimNextPendingMessage('a').message_id).toBe('bg');
        expect(q.claimNextPendingMessage('a')).toBeNull();

        expect(q.getPendingAgents()).toEqual([]);
        expect(q.getPendingAgents(Date.now() + 2 * HOUR)).toEqual(['a']);
        expect(q.claimNextPendingMessage('a', Date.now() + 2 * HOUR).message_id).toBe('held');
    });

    it('does not count a held user message as someone waiting', () => {
        const id = enqueue('held');
        claimAndRun();
        q.requeueMessageAt(id, Date.now() + HOUR, 'limit', { unknownReset: true });
        expect(q.oldestPendingUserMessageAge('a')).toBeNull();
        expect(q.oldestPendingUserMessageAge('a', Date.now() + HOUR + 1_000)).toBeLessThan(10_000);
    });

    it('still lists held rows as waiting in the queue', () => {
        const id = enqueue('held');
        claimAndRun();
        q.requeueMessageAt(id, Date.now() + HOUR, 'limit', { unknownReset: true });
        expect(q.getProcessingMessages().map(r => r.id)).toEqual([id]);
    });
});

describe('provider pauses', () => {
    it('keeps the later of two pauses for one provider and drops expired ones', () => {
        const now = Date.now();
        q.setProviderPause('anthropic', now + HOUR);
        q.setProviderPause('anthropic', now + 30 * 60_000);
        q.setProviderPause('openai', now + 10_000);
        expect(q.getProviderPauses(now)).toEqual(new Map([['anthropic', now + HOUR], ['openai', now + 10_000]]));
        expect(q.getProviderPauses(now + 20_000)).toEqual(new Map([['anthropic', now + HOUR]]));

        q.setProviderPause('openai', now + 5 * HOUR);
        expect(q.getProviderPauses(now + 2 * HOUR)).toEqual(new Map([['openai', now + 5 * HOUR]]));
    });

    it('survives a reopen of the database', () => {
        const until = Date.now() + HOUR;
        q.setProviderPause('anthropic', until);
        q.closeQueueDb();
        q.initQueueDb();
        expect(q.getProviderPauses().get('anthropic')).toBe(until);
    });
});

describe('migration from a v3 database', () => {
    it('adds the pause columns and table and keeps pending rows claimable', () => {
        const id = enqueue('old');
        q.closeQueueDb();
        const d = new Database(dbPath);
        d.exec('DROP TABLE provider_pauses');
        for (const col of ['not_before', 'paused_ms', 'unknown_resets']) d.exec(`ALTER TABLE messages DROP COLUMN ${col}`);
        d.pragma('user_version = 3');
        d.close();

        q.initQueueDb();
        expect(row(id)).toMatchObject({ status: 'pending', not_before: null, paused_ms: 0, unknown_resets: 0 });
        expect(q.claimNextPendingMessage('a').id).toBe(id);
        q.setProviderPause('anthropic', Date.now() + HOUR);
        expect(q.getProviderPauses().has('anthropic')).toBe(true);
    });
});
