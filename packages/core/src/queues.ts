/**
 * SQLite-backed queue: messages, responses, and per-agent chat history.
 */

import Database from 'better-sqlite3';
import path from 'path';
import { EventEmitter } from 'events';
import { FONTE_HOME } from './config';
import { MessageJobData, ResponseJobData } from './types';

const QUEUE_DB_PATH = path.join(FONTE_HOME, 'fonte.db');
const MAX_RETRIES = 5;

let db: Database.Database | null = null;
export const queueEvents = new EventEmitter();

export function initQueueDb(): void {
    if (db) return;
    db = new Database(QUEUE_DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');

    db.exec(`
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id TEXT NOT NULL UNIQUE,
            channel TEXT NOT NULL, sender TEXT NOT NULL, sender_id TEXT,
            message TEXT NOT NULL, agent TEXT,
            from_agent TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            retry_count INTEGER NOT NULL DEFAULT 0, last_error TEXT,
            created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS responses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id TEXT NOT NULL,
            channel TEXT NOT NULL, sender TEXT NOT NULL, sender_id TEXT,
            message TEXT NOT NULL, original_message TEXT NOT NULL,
            agent TEXT, files TEXT, metadata TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at INTEGER NOT NULL, acked_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS agent_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agent_id TEXT NOT NULL,
            role TEXT NOT NULL,
            channel TEXT NOT NULL,
            sender TEXT NOT NULL,
            message_id TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_msg_status ON messages(status, agent, created_at);
        CREATE INDEX IF NOT EXISTS idx_resp_channel ON responses(channel, status);
        CREATE INDEX IF NOT EXISTS idx_agent_messages_agent ON agent_messages(agent_id, created_at);
    `);

    // Migrations for existing databases
    const respCols = db.prepare("PRAGMA table_info(responses)").all() as { name: string }[];
    if (!respCols.some(c => c.name === 'metadata')) {
        db.exec('ALTER TABLE responses ADD COLUMN metadata TEXT');
    }
    const msgCols = db.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
    if (msgCols.some(c => c.name === 'files')) {
        db.exec('ALTER TABLE messages DROP COLUMN files');
    }
    if (msgCols.some(c => c.name === 'conversation_id')) {
        db.exec('ALTER TABLE messages DROP COLUMN conversation_id');
    }
    if (!msgCols.some(c => c.name === 'session_id')) {
        db.exec('ALTER TABLE messages ADD COLUMN session_id TEXT');
    }
    if (!msgCols.some(c => c.name === 'resume_session_id')) {
        db.exec('ALTER TABLE messages ADD COLUMN resume_session_id TEXT');
    }
    if (!msgCols.some(c => c.name === 'lane')) {
        db.exec("ALTER TABLE messages ADD COLUMN lane TEXT NOT NULL DEFAULT 'user'");
    }
    if (!msgCols.some(c => c.name === 'recovery')) {
        db.exec('ALTER TABLE messages ADD COLUMN recovery INTEGER NOT NULL DEFAULT 0');
    }
    const amCols = db.prepare("PRAGMA table_info(agent_messages)").all() as { name: string }[];
    if (!amCols.some(c => c.name === 'kind')) {
        db.exec("ALTER TABLE agent_messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'text'");
    }
}

function getDb(): Database.Database {
    if (!db) throw new Error('Queue DB not initialized — call initQueueDb() first');
    return db;
}

// ── Messages ────────────────────────────────────────────────────────────────

export function enqueueMessage(data: MessageJobData): number | null {
    const now = Date.now();
    try {
        const r = getDb().prepare(
            `INSERT INTO messages (message_id,channel,sender,sender_id,message,agent,from_agent,resume_session_id,lane,status,created_at,updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,'pending',?,?)`
        ).run(data.messageId, data.channel, data.sender, data.senderId ?? null, data.message,
            data.agent ?? null, data.fromAgent ?? null, data.resumeSessionId ?? null, data.lane ?? 'user', now, now);
        queueEvents.emit('message:enqueued', { id: r.lastInsertRowid, agent: data.agent });
        return r.lastInsertRowid as number;
    } catch (err: any) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return null; // duplicate messageId — already enqueued
        }
        throw err;
    }
}

export function getPendingAgents(): string[] {
    return (getDb().prepare(
        `SELECT DISTINCT COALESCE(agent,'default') as agent FROM messages WHERE status='pending'`
    ).all() as { agent: string }[]).map(r => r.agent);
}

/**
 * Claim the next pending message for an agent: user-lane rows first, then by
 * arrival, so a person typing never waits behind a queue of background wakes.
 */
export function claimNextPendingMessage(agentId: string): any | null {
    const d = getDb();
    return d.transaction(() => {
        const row = d.prepare(
            `SELECT * FROM messages WHERE status='pending' AND (agent=? OR (agent IS NULL AND ?='default'))
             ORDER BY CASE lane WHEN 'user' THEN 0 ELSE 1 END, created_at LIMIT 1`
        ).get(agentId, agentId) as any;
        if (!row) return null;
        d.prepare(`UPDATE messages SET status='queued',updated_at=? WHERE id=?`).run(Date.now(), row.id);
        return { ...row, status: 'queued' };
    }).immediate();
}

export function oldestPendingUserMessageAge(agentId: string): number | null {
    const row = getDb().prepare(
        `SELECT MIN(created_at) AS oldest FROM messages WHERE status='pending' AND lane='user' AND (agent=? OR (agent IS NULL AND ?='default'))`
    ).get(agentId, agentId) as { oldest: number | null };
    return row?.oldest == null ? null : Date.now() - row.oldest;
}

export function claimAllPendingMessages(agentId: string): any[] {
    const d = getDb();
    return d.transaction(() => {
        const rows = d.prepare(
            `SELECT * FROM messages WHERE status='pending' AND (agent=? OR (agent IS NULL AND ?='default')) ORDER BY created_at`
        ).all(agentId, agentId) as any[];
        if (rows.length === 0) return [];
        const now = Date.now();
        const ids = rows.map((r: any) => r.id);
        d.prepare(`UPDATE messages SET status='queued',updated_at=? WHERE id IN (${ids.map(() => '?').join(',')})`).run(now, ...ids);
        return rows.map((r: any) => ({ ...r, status: 'queued' }));
    }).immediate();
}

export function markProcessing(rowId: number): void {
    getDb().prepare(`UPDATE messages SET status='processing',updated_at=? WHERE id=? AND status='queued'`).run(Date.now(), rowId);
}

// Guarded transitions: a user-cancelled row is terminal, so neither a late
// completion nor a retry may overwrite it.
export function completeMessage(rowId: number): void {
    getDb().prepare(`UPDATE messages SET status='completed',updated_at=? WHERE id=? AND status='processing'`).run(Date.now(), rowId);
}

/** Returns the row's new status: pending (will retry) or dead (retries exhausted). */
export function failMessage(rowId: number, error: string): 'pending' | 'dead' | null {
    const d = getDb();
    const msg = d.prepare('SELECT retry_count FROM messages WHERE id=?').get(rowId) as { retry_count: number } | undefined;
    if (!msg) return null;
    const newStatus = msg.retry_count + 1 >= MAX_RETRIES ? 'dead' : 'pending';
    d.prepare(`UPDATE messages SET status=?,retry_count=?,last_error=?,updated_at=? WHERE id=? AND status!='cancelled'`)
        .run(newStatus, msg.retry_count + 1, error, Date.now(), rowId);
    return newStatus;
}

export function getMessageStatus(rowId: number): string | null {
    const row = getDb().prepare('SELECT status FROM messages WHERE id=?').get(rowId) as { status: string } | undefined;
    return row?.status ?? null;
}

/**
 * Watchdog pause: a processing row goes back to pending, retry count untouched,
 * so it re-runs after the user-lane message that displaced it.
 */
export function interruptMessage(rowId: number): boolean {
    return getDb().prepare(
        `UPDATE messages SET status='pending',updated_at=? WHERE id=? AND status='processing'`
    ).run(Date.now(), rowId).changes > 0;
}

/** User-initiated stop: terminal, no retry. Returns false if the row already settled. */
export function cancelMessage(rowId: number): boolean {
    return getDb().prepare(
        `UPDATE messages SET status='cancelled',updated_at=? WHERE id=? AND status IN ('pending','queued','processing')`
    ).run(Date.now(), rowId).changes > 0;
}

export function setMessageSessionId(rowId: number, sessionId: string): void {
    getDb().prepare(`UPDATE messages SET session_id=? WHERE id=?`).run(sessionId, rowId);
}

/** Rows that are waiting or running, in queue order: running first, then by lane and arrival. */
export function getProcessingMessages(): any[] {
    return getDb().prepare(
        `SELECT * FROM messages WHERE status IN ('pending','queued','processing')
         ORDER BY CASE status WHEN 'processing' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END, CASE lane WHEN 'user' THEN 0 ELSE 1 END, created_at`
    ).all();
}

export function getProcessingMessage(rowId: number): any | null {
    return getDb().prepare(`SELECT * FROM messages WHERE id=? AND status IN ('pending','queued','processing')`).get(rowId) ?? null;
}

export const MAX_RECOVERIES = 3;

/**
 * Rows left in flight by a crashed or restarted daemon go back to pending with
 * their recovery count bumped; a row that keeps dying is parked as dead.
 */
export function recoverStaleMessages(thresholdMs = 10 * 60 * 1000): number {
    const d = getDb();
    const cutoff = Date.now() - thresholdMs;
    d.prepare(`UPDATE messages SET status='dead',last_error='Interrupted repeatedly',updated_at=? WHERE status IN ('processing','queued') AND updated_at<? AND recovery>=?`)
        .run(Date.now(), cutoff, MAX_RECOVERIES - 1);
    return d.prepare(`UPDATE messages SET status='pending',recovery=recovery+1,updated_at=? WHERE status IN ('processing','queued') AND updated_at<?`)
        .run(Date.now(), cutoff).changes;
}

// ── Responses ───────────────────────────────────────────────────────────────

export function enqueueResponse(data: ResponseJobData): number {
    const r = getDb().prepare(
        `INSERT INTO responses (message_id,channel,sender,sender_id,message,original_message,agent,files,metadata,status,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,'pending',?)`
    ).run(data.messageId, data.channel, data.sender, data.senderId ?? null, data.message,
        data.originalMessage, data.agent ?? null, data.files ? JSON.stringify(data.files) : null,
        data.metadata ? JSON.stringify(data.metadata) : null, Date.now());
    return r.lastInsertRowid as number;
}

export function getResponsesForChannel(channel: string): any[] {
    return getDb().prepare(`SELECT * FROM responses WHERE channel=? AND status='pending' ORDER BY created_at`).all(channel);
}

export function ackResponse(responseId: number): void {
    getDb().prepare(`UPDATE responses SET status='acked',acked_at=? WHERE id=?`).run(Date.now(), responseId);
}

export function getRecentResponses(limit: number): any[] {
    return getDb().prepare(`SELECT * FROM responses ORDER BY created_at DESC LIMIT ?`).all(limit);
}

// ── Queue status ────────────────────────────────────────────────────────────

export function getQueueStatus() {
    const d = getDb();
    const counts = d.prepare(`SELECT status, COUNT(*) as cnt FROM messages GROUP BY status`).all() as { status: string; cnt: number }[];
    const result: any = { pending: 0, queued: 0, processing: 0, completed: 0, dead: 0, responsesPending: 0 };
    for (const row of counts) if (row.status in result) result[row.status] = row.cnt;
    result.responsesPending = (d.prepare(`SELECT COUNT(*) as cnt FROM responses WHERE status='pending'`).get() as { cnt: number }).cnt;
    return result;
}

export function getAgentQueueStatus(): { agent: string; pending: number; queued: number; processing: number }[] {
    return getDb().prepare(
        `SELECT COALESCE(agent,'default') as agent,
                SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN status='queued' THEN 1 ELSE 0 END) as queued,
                SUM(CASE WHEN status='processing' THEN 1 ELSE 0 END) as processing
         FROM messages WHERE status IN ('pending','queued','processing') GROUP BY agent`
    ).all() as { agent: string; pending: number; queued: number; processing: number }[];
}

export function getDeadMessages(): any[] {
    return getDb().prepare(`SELECT * FROM messages WHERE status='dead' ORDER BY updated_at DESC`).all();
}

export function retryDeadMessage(rowId: number): boolean {
    return getDb().prepare(`UPDATE messages SET status='pending',retry_count=0,updated_at=? WHERE id=? AND status='dead'`).run(Date.now(), rowId).changes > 0;
}

export function deleteDeadMessage(rowId: number): boolean {
    return getDb().prepare(`DELETE FROM messages WHERE id=? AND status='dead'`).run(rowId).changes > 0;
}

export function pruneAckedResponses(olderThanMs = 86400000): number {
    return getDb().prepare(`DELETE FROM responses WHERE status='acked' AND acked_at<?`).run(Date.now() - olderThanMs).changes;
}

export function pruneCompletedMessages(olderThanMs = 86400000): number {
    return getDb().prepare(`DELETE FROM messages WHERE status IN ('completed','cancelled') AND updated_at<?`).run(Date.now() - olderThanMs).changes;
}

// ── Agent messages (per-agent chat history) ─────────────────────────────────

export function insertAgentMessage(data: {
    agentId: string; role: 'user' | 'assistant';
    channel: string; sender: string; messageId: string; content: string;
    /** 'text' (default) | 'tool' (content = JSON {name, input}) | 'system'. */
    kind?: string;
}): number {
    return getDb().prepare(
        `INSERT INTO agent_messages (agent_id,role,channel,sender,message_id,content,kind,created_at) VALUES (?,?,?,?,?,?,?,?)`
    ).run(data.agentId, data.role, data.channel, data.sender, data.messageId, data.content, data.kind ?? 'text', Date.now()).lastInsertRowid as number;
}

/** History truncation for edit-and-rerun: drops this row and everything after it. */
export function deleteAgentMessagesFrom(agentId: string, fromRowId: number): number {
    return getDb().prepare(
        `DELETE FROM agent_messages WHERE agent_id=? AND id>=?`
    ).run(agentId, fromRowId).changes;
}

export function getAgentMessages(agentId: string, limit = 100, sinceId = 0): any[] {
    // sessionId rides along for edit-and-rerun; it goes null once the source
    // messages row is pruned.
    return getDb().prepare(
        `SELECT am.*, m.session_id AS sessionId
         FROM agent_messages am
         LEFT JOIN messages m ON m.message_id = am.message_id
         WHERE am.agent_id=? AND am.id>? ORDER BY am.created_at DESC LIMIT ?`
    ).all(agentId, sinceId, limit);
}

export function deleteAgentMessagesByMessageId(agentId: string, messageId: string, role?: 'user' | 'assistant'): number {
    return role
        ? getDb().prepare(`DELETE FROM agent_messages WHERE agent_id=? AND message_id=? AND role=?`).run(agentId, messageId, role).changes
        : getDb().prepare(`DELETE FROM agent_messages WHERE agent_id=? AND message_id=?`).run(agentId, messageId).changes;
}

/** Marks a stored tool row settled; the row is found by the tool-use id inside its JSON. */
export function updateAgentToolMessage(agentId: string, messageId: string, toolUseId: string, patch: Record<string, unknown>): boolean {
    const d = getDb();
    const row = d.prepare(
        `SELECT id, content FROM agent_messages WHERE agent_id=? AND message_id=? AND kind='tool' AND content LIKE ? ORDER BY id DESC LIMIT 1`
    ).get(agentId, messageId, `%${JSON.stringify(toolUseId)}%`) as { id: number; content: string } | undefined;
    if (!row) return false;
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(row.content); } catch { return false; }
    if (parsed.toolUseId !== toolUseId) return false;
    d.prepare(`UPDATE agent_messages SET content=? WHERE id=?`).run(JSON.stringify({ ...parsed, ...patch }), row.id);
    return true;
}

export function getLastAssistantMessageByMessageIdPrefix(prefix: string): any | null {
    const row = getDb().prepare(
        `SELECT * FROM agent_messages WHERE message_id LIKE ? AND role='assistant' ORDER BY created_at DESC LIMIT 1`
    ).get(prefix + '%');
    return row || null;
}

export function getAllAgentMessages(limit = 100): any[] {
    return getDb().prepare(
        `SELECT * FROM agent_messages ORDER BY created_at DESC LIMIT ?`
    ).all(limit);
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

export function closeQueueDb(): void {
    if (db) { db.close(); db = null; }
}
