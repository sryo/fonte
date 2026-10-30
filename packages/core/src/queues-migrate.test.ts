import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

let tmpHome: string;
let dbPath: string;
let backupDir: string;
let q: typeof import('./queues');

beforeAll(async () => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fonte-queues-migrate-test-'));
    fs.mkdirSync(path.join(tmpHome, 'logs'), { recursive: true });
    process.env.FONTE_HOME = tmpHome;
    dbPath = path.join(tmpHome, 'fonte.db');
    backupDir = path.join(tmpHome, 'backups');
    q = await import('./queues');
});

afterAll(() => {
    q.closeQueueDb();
    delete process.env.FONTE_HOME;
    fs.rmSync(tmpHome, { recursive: true, force: true });
});

beforeEach(() => {
    for (const f of ['fonte.db', 'fonte.db-wal', 'fonte.db-shm']) fs.rmSync(path.join(tmpHome, f), { force: true });
    fs.rmSync(backupDir, { recursive: true, force: true });
});

afterEach(() => q.closeQueueDb());

const columns = (d: Database.Database, table: string) =>
    (d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(c => c.name);
const backups = () => fs.existsSync(backupDir) ? fs.readdirSync(backupDir) : [];

function inspect<T>(fn: (d: Database.Database) => T): T {
    q.closeQueueDb();
    const d = new Database(dbPath, { readonly: true });
    try { return fn(d); } finally { d.close(); }
}

function current() {
    return inspect(d => ({
        version: d.pragma('user_version', { simple: true }) as number,
        messages: columns(d, 'messages'),
        responses: columns(d, 'responses'),
        agentMessages: columns(d, 'agent_messages'),
    }));
}

function buildLegacyDb(): void {
    const d = new Database(dbPath);
    d.exec(`
        CREATE TABLE messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id TEXT NOT NULL UNIQUE,
            channel TEXT NOT NULL, sender TEXT NOT NULL, sender_id TEXT,
            message TEXT NOT NULL, agent TEXT, files TEXT, conversation_id TEXT,
            from_agent TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            retry_count INTEGER NOT NULL DEFAULT 0, last_error TEXT,
            created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
        CREATE TABLE responses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id TEXT NOT NULL,
            channel TEXT NOT NULL, sender TEXT NOT NULL, sender_id TEXT,
            message TEXT NOT NULL, original_message TEXT NOT NULL,
            agent TEXT, files TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at INTEGER NOT NULL, acked_at INTEGER
        );
        CREATE TABLE agent_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agent_id TEXT NOT NULL, role TEXT NOT NULL, channel TEXT NOT NULL,
            sender TEXT NOT NULL, message_id TEXT NOT NULL, content TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        INSERT INTO messages (message_id,channel,sender,message,agent,files,conversation_id,status,created_at,updated_at)
            VALUES ('m-old','web','me','hello','a','["x"]','conv-1','pending',1,1);
        INSERT INTO responses (message_id,channel,sender,message,original_message,agent,status,created_at)
            VALUES ('m-old','web','me','reply','hello','a','pending',2);
        INSERT INTO agent_messages (agent_id,role,channel,sender,message_id,content,created_at)
            VALUES ('a','user','web','me','m-old','hello',3);
    `);
    d.close();
}

const EXPECTED = {
    messages: ['id', 'message_id', 'channel', 'sender', 'sender_id', 'message', 'agent', 'from_agent', 'status',
        'retry_count', 'last_error', 'created_at', 'updated_at', 'session_id', 'resume_session_id', 'lane', 'recovery', 'fresh_session'],
    responses: ['id', 'message_id', 'channel', 'sender', 'sender_id', 'message', 'original_message', 'agent',
        'files', 'metadata', 'status', 'created_at', 'acked_at'],
    agentMessages: ['id', 'agent_id', 'role', 'channel', 'sender', 'message_id', 'content', 'created_at', 'kind'],
};

describe('queue DB migrations', () => {
    it('creates the current schema on a fresh install with no backup', () => {
        q.initQueueDb();
        const s = current();
        expect(s.version).toBeGreaterThanOrEqual(1);
        expect([...s.messages].sort()).toEqual([...EXPECTED.messages].sort());
        expect([...s.responses].sort()).toEqual([...EXPECTED.responses].sort());
        expect([...s.agentMessages].sort()).toEqual([...EXPECTED.agentMessages].sort());
        expect(backups()).toEqual([]);
    });

    it('brings a pre-versioning database to the current shape, keeps its rows, and backs it up first', () => {
        buildLegacyDb();
        q.initQueueDb();

        expect(q.claimNextPendingMessage('a')).toMatchObject({ message_id: 'm-old', message: 'hello', lane: 'user', recovery: 0 });
        expect(q.getResponsesForChannel('web')).toMatchObject([{ message: 'reply', metadata: null }]);
        expect(q.getAgentMessages('a')).toMatchObject([{ content: 'hello', kind: 'text' }]);

        const s = current();
        expect(s.messages).not.toContain('files');
        expect(s.messages).not.toContain('conversation_id');
        expect([...s.messages].sort()).toEqual([...EXPECTED.messages].sort());
        expect(s.responses).toContain('metadata');
        expect(s.agentMessages).toContain('kind');

        const files = backups();
        expect(files).toHaveLength(1);
        expect(files[0]).toMatch(/^fonte-v0-.+\.db$/);
        const copy = new Database(path.join(backupDir, files[0]), { readonly: true });
        expect(columns(copy, 'messages')).toContain('conversation_id');
        expect(copy.prepare('SELECT files FROM messages').get()).toEqual({ files: '["x"]' });
        copy.close();
    });

    it('stamps a version-0 database already in the current shape without changing it', () => {
        q.initQueueDb();
        q.enqueueMessage({ messageId: 'm1', channel: 'web', sender: 'me', message: 'hi', agent: 'a' } as any);
        const { version } = current();
        const d = new Database(dbPath);
        d.pragma('user_version = 0');
        d.close();

        q.initQueueDb();
        expect(q.getProcessingMessages()).toHaveLength(1);
        expect(current().version).toBe(version);
        expect(backups()).toHaveLength(1);
    });

    it('opens an up-to-date database without running anything or backing it up', () => {
        q.initQueueDb();
        q.closeQueueDb();
        q.initQueueDb();
        q.closeQueueDb();
        q.initQueueDb();
        expect(backups()).toEqual([]);
    });

    it('refuses a database left by a newer build', () => {
        const d = new Database(dbPath);
        d.exec('CREATE TABLE messages (id INTEGER)');
        d.pragma('user_version = 999');
        d.close();
        expect(() => q.initQueueDb()).toThrow(/fonte\.db.*999/);
        expect(() => q.getQueueStatus()).toThrow(/not initialized/);
        expect(backups()).toEqual([]);
    });

    it('runs with WAL and the shared pragmas', () => {
        q.initQueueDb();
        q.maintainQueueDb();
        expect(fs.statSync(`${dbPath}-wal`).size).toBe(0);
        expect(inspect(d => d.pragma('journal_mode', { simple: true }))).toBe('wal');
    });
});
