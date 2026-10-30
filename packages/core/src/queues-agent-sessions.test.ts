import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

let tmpHome: string;
let dbPath: string;
let q: typeof import('./queues');

beforeAll(async () => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fonte-queues-sessions-test-'));
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
});

afterEach(() => q.closeQueueDb());

describe('agent session store', () => {
    it('keeps one session per agent and lane, replacing it on set', () => {
        q.initQueueDb();
        expect(q.getAgentSession('a', 'user')).toBeNull();

        q.setAgentSession('a', 'user', 'anthropic', 's1');
        q.setAgentSession('a', 'background', 'anthropic', 'b1');
        q.setAgentSession('b', 'user', 'openai', 'x1');
        q.setAgentSession('a', 'user', 'anthropic', 's2');

        expect(q.getAgentSession('a', 'user')).toMatchObject({ provider: 'anthropic', sessionId: 's2' });
        expect(q.getAgentSession('a', 'background')).toMatchObject({ provider: 'anthropic', sessionId: 'b1' });
        expect(q.getAgentSession('b', 'user')).toMatchObject({ provider: 'openai', sessionId: 'x1' });
    });

    it('clears one lane or every lane of one agent', () => {
        q.initQueueDb();
        q.setAgentSession('a', 'user', 'anthropic', 's1');
        q.setAgentSession('a', 'background', 'anthropic', 'b1');
        q.setAgentSession('b', 'user', 'anthropic', 'x1');

        expect(q.clearAgentSessions('a', 'background')).toBe(1);
        expect(q.getAgentSession('a', 'background')).toBeNull();
        expect(q.getAgentSession('a', 'user')).not.toBeNull();

        q.setAgentSession('a', 'background', 'anthropic', 'b2');
        expect(q.clearAgentSessions('a')).toBe(2);
        expect(q.getAgentSession('a', 'user')).toBeNull();
        expect(q.getAgentSession('b', 'user')).toMatchObject({ sessionId: 'x1' });
    });

    it('seeds the user lane from the latest captured session when a v1 database upgrades', () => {
        q.initQueueDb();
        const add = (messageId: string, agent: string | undefined, lane: 'user' | 'background', session: string | null) => {
            const id = q.enqueueMessage({ messageId, channel: 'web', sender: 'me', message: 'hi', agent, lane })!;
            if (session) q.setMessageSessionId(id, session);
        };
        add('m1', 'a', 'user', 'old');
        add('m2', 'a', 'user', 'latest');
        add('m3', 'a', 'user', null);
        add('m4', 'a', 'background', 'automation');
        add('m5', 'b', 'background', 'only-background');
        add('m6', undefined, 'user', 'unrouted');
        q.closeQueueDb();

        const d = new Database(dbPath);
        d.exec('DROP TABLE agent_sessions');
        d.pragma('user_version = 1');
        d.close();

        q.initQueueDb();
        expect(q.getAgentSession('a', 'user')).toMatchObject({ provider: 'anthropic', sessionId: 'latest' });
        expect(q.getAgentSession('a', 'background')).toBeNull();
        expect(q.getAgentSession('b', 'user')).toBeNull();
        expect(q.getAgentSession('b', 'background')).toBeNull();
    });

    it('offers only user-lane sessions to edit-and-rerun, so a chat never forks from an automation', () => {
        q.initQueueDb();
        const turn = (messageId: string, lane: 'user' | 'background', session: string) => {
            const id = q.enqueueMessage({ messageId, channel: 'web', sender: 'me', message: 'hi', agent: 'a', lane })!;
            q.setMessageSessionId(id, session);
            q.insertAgentMessage({ agentId: 'a', role: 'assistant', channel: 'web', sender: 'a', messageId, content: messageId });
        };
        turn('chat', 'user', 'chat-session');
        turn('auto', 'background', 'automation-session');

        const rows = q.getAgentMessages('a');
        expect(rows.find(r => r.content === 'chat').sessionId).toBe('chat-session');
        expect(rows.find(r => r.content === 'auto').sessionId).toBeNull();
    });
});

describe('fresh-session messages', () => {
    it('keep the freshSession flag on the queued row', () => {
        q.initQueueDb();
        const fresh = q.enqueueMessage({ messageId: 'm-fresh', channel: 'api', sender: 'me', message: 'hi', agent: 'a', freshSession: true })!;
        const normal = q.enqueueMessage({ messageId: 'm-normal', channel: 'api', sender: 'me', message: 'hi', agent: 'a' })!;
        const db = new Database(dbPath, { readonly: true });
        const flag = (id: number) => (db.prepare('SELECT fresh_session FROM messages WHERE id=?').get(id) as { fresh_session: number }).fresh_session;
        expect(flag(fresh)).toBe(1);
        expect(flag(normal)).toBe(0);
        db.close();
    });
});
