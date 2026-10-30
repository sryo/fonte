/**
 * SQLite-backed queue: messages, responses, and per-agent chat history.
 */

import Database from 'better-sqlite3';
import path from 'path';
import { EventEmitter } from 'events';
import { FONTE_HOME } from './config';
import { log } from './logging';
import { Migration, applyPragmas, maintainDb, runMigrations } from './sqlite-migrate';
import { MessageJobData, MessageLane, ResponseJobData } from './types';
import type { StoredAgentSession } from './agent-session';

const QUEUE_DB_PATH = path.join(FONTE_HOME, 'fonte.db');
const BACKUP_DIR = path.join(FONTE_HOME, 'backups');
const MAX_RETRIES = 5;

let db: Database.Database | null = null;
export const queueEvents = new EventEmitter();

// Append only; never edit a shipped migration. v1 stays idempotent because
// databases from before versioning arrive at user_version 0 in any older shape.
const QUEUE_MIGRATIONS: Migration[] = [
    {
        version: 1,
        name: 'baseline schema',
        up(db) {
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
        },
    },
    {
        version: 2,
        name: 'agent sessions',
        up(db) {
            db.exec(`
                CREATE TABLE IF NOT EXISTS agent_sessions (
                    agent_id TEXT NOT NULL,
                    lane TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    session_id TEXT NOT NULL,
                    updated_at INTEGER NOT NULL,
                    PRIMARY KEY (agent_id, lane)
                );
            `);
            // Only the Claude adapter reported session ids before this version. The
            // background lane is left to start its own conversation.
            db.exec(`
                INSERT OR IGNORE INTO agent_sessions (agent_id,lane,provider,session_id,updated_at)
                SELECT m.agent, 'user', 'anthropic', m.session_id, m.updated_at FROM messages m
                WHERE m.id IN (
                    SELECT MAX(id) FROM messages
                    WHERE agent IS NOT NULL AND lane='user' AND session_id IS NOT NULL
                    GROUP BY agent
                );
            `);
        },
    },
    {
        version: 3,
        name: 'fresh-session messages',
        up(db) {
            const cols = db.prepare('PRAGMA table_info(messages)').all() as { name: string }[];
            if (!cols.some(c => c.name === 'fresh_session')) {
                db.exec('ALTER TABLE messages ADD COLUMN fresh_session INTEGER NOT NULL DEFAULT 0');
            }
        },
    },
    {
        version: 4,
        name: 'rate-limit pauses',
        up(db) {
            const cols = db.prepare('PRAGMA table_info(messages)').all() as { name: string }[];
            if (!cols.some(c => c.name === 'not_before')) {
                db.exec('ALTER TABLE messages ADD COLUMN not_before INTEGER');
            }
            if (!cols.some(c => c.name === 'paused_ms')) {
                db.exec('ALTER TABLE messages ADD COLUMN paused_ms INTEGER NOT NULL DEFAULT 0');
            }
            if (!cols.some(c => c.name === 'unknown_resets')) {
                db.exec('ALTER TABLE messages ADD COLUMN unknown_resets INTEGER NOT NULL DEFAULT 0');
            }
            db.exec(`
                CREATE TABLE IF NOT EXISTS provider_pauses (
                    provider TEXT PRIMARY KEY,
                    until INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );
            `);
        },
    },
];

export function initQueueDb(): void {
    if (db) return;
    const conn = new Database(QUEUE_DB_PATH);
    try {
        applyPragmas(conn);
        runMigrations(conn, QUEUE_MIGRATIONS, { dbPath: QUEUE_DB_PATH, backupDir: BACKUP_DIR, log });
    } catch (err) {
        conn.close();
        throw err;
    }
    db = conn;
}

export function maintainQueueDb(): void {
    if (db) maintainDb(db);
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
            `INSERT INTO messages (message_id,channel,sender,sender_id,message,agent,from_agent,resume_session_id,fresh_session,lane,status,created_at,updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,'pending',?,?)`
        ).run(data.messageId, data.channel, data.sender, data.senderId ?? null, data.message,
            data.agent ?? null, data.fromAgent ?? null, data.resumeSessionId ?? null, data.freshSession ? 1 : 0,
            data.lane ?? 'user', now, now);
        queueEvents.emit('message:enqueued', { id: r.lastInsertRowid, agent: data.agent });
        return r.lastInsertRowid as number;
    } catch (err: any) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return null; // duplicate messageId — already enqueued
        }
        throw err;
    }
}

// A pending row held by a rate-limit pause is not due until its not_before.
const DUE = '(not_before IS NULL OR not_before<=?)';

export function getPendingAgents(now = Date.now()): string[] {
    return (getDb().prepare(
        `SELECT DISTINCT COALESCE(agent,'default') as agent FROM messages WHERE status='pending' AND ${DUE}`
    ).all(now) as { agent: string }[]).map(r => r.agent);
}

/**
 * Claim the next due pending message for an agent: user-lane rows first, then
 * by arrival, so a person typing never waits behind a queue of background wakes.
 */
export function claimNextPendingMessage(agentId: string, now = Date.now()): any | null {
    const d = getDb();
    return d.transaction(() => {
        const row = d.prepare(
            `SELECT * FROM messages WHERE status='pending' AND ${DUE} AND (agent=? OR (agent IS NULL AND ?='default'))
             ORDER BY CASE lane WHEN 'user' THEN 0 ELSE 1 END, created_at LIMIT 1`
        ).get(now, agentId, agentId) as any;
        if (!row) return null;
        d.prepare(`UPDATE messages SET status='queued',updated_at=? WHERE id=?`).run(Date.now(), row.id);
        return { ...row, status: 'queued' };
    }).immediate();
}

/** How long the longest-waiting due user-lane message has waited, counted from when it became due. */
export function oldestPendingUserMessageAge(agentId: string, now = Date.now()): number | null {
    const row = getDb().prepare(
        `SELECT MIN(MAX(created_at, COALESCE(not_before, 0))) AS oldest FROM messages
         WHERE status='pending' AND lane='user' AND ${DUE} AND (agent=? OR (agent IS NULL AND ?='default'))`
    ).get(now, agentId, agentId) as { oldest: number | null };
    return row?.oldest == null ? null : now - row.oldest;
}

export function claimAllPendingMessages(agentId: string, now = Date.now()): any[] {
    const d = getDb();
    return d.transaction(() => {
        const rows = d.prepare(
            `SELECT * FROM messages WHERE status='pending' AND ${DUE} AND (agent=? OR (agent IS NULL AND ?='default')) ORDER BY created_at`
        ).all(now, agentId, agentId) as any[];
        if (rows.length === 0) return [];
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

/**
 * Straight to the dead letter list, no automatic retry: the cause (expired
 * sign-in, billing) won't clear on its own, so a person retries or deletes it.
 */
export function deadLetterMessage(rowId: number, error: string): boolean {
    return getDb().prepare(
        `UPDATE messages SET status='dead',retry_count=retry_count+1,last_error=?,updated_at=? WHERE id=? AND status IN ('queued','processing')`
    ).run(error, Date.now(), rowId).changes > 0;
}

/**
 * Rate-limit pause: a running row goes back to pending, held until
 * `notBefore`, retry count untouched. `paused_ms` adds up how long it has been
 * held in total; `unknown_resets` counts back-to-back pauses whose reset time
 * the provider never gave.
 */
export function requeueMessageAt(rowId: number, notBefore: number, error: string, opts: { unknownReset: boolean }): boolean {
    const now = Date.now();
    return getDb().prepare(
        `UPDATE messages SET status='pending',not_before=?,last_error=?,paused_ms=paused_ms+?,
            unknown_resets=CASE WHEN ? THEN unknown_resets+1 ELSE 0 END,updated_at=?
         WHERE id=? AND status IN ('queued','processing')`
    ).run(notBefore, error, Math.max(0, notBefore - now), opts.unknownReset ? 1 : 0, now, rowId).changes > 0;
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

// ── Agent sessions (provider conversation per agent and lane) ───────────────

export function getAgentSession(agentId: string, lane: MessageLane): StoredAgentSession | null {
    const row = getDb().prepare(
        `SELECT provider, session_id FROM agent_sessions WHERE agent_id=? AND lane=?`
    ).get(agentId, lane) as { provider: string; session_id: string } | undefined;
    return row ? { provider: row.provider, sessionId: row.session_id } : null;
}

export function setAgentSession(agentId: string, lane: MessageLane, provider: string, sessionId: string): void {
    getDb().prepare(
        `INSERT INTO agent_sessions (agent_id,lane,provider,session_id,updated_at) VALUES (?,?,?,?,?)
         ON CONFLICT(agent_id,lane) DO UPDATE SET provider=excluded.provider,session_id=excluded.session_id,updated_at=excluded.updated_at`
    ).run(agentId, lane, provider, sessionId, Date.now());
}

/** Without a lane, clears every lane of the agent. */
export function clearAgentSessions(agentId: string, lane?: MessageLane): number {
    return lane
        ? getDb().prepare(`DELETE FROM agent_sessions WHERE agent_id=? AND lane=?`).run(agentId, lane).changes
        : getDb().prepare(`DELETE FROM agent_sessions WHERE agent_id=?`).run(agentId).changes;
}

// ── Provider pauses (a usage limit holds every agent on that provider) ─────

/** Holds the provider until `until`; an existing later pause wins. */
export function setProviderPause(provider: string, until: number): void {
    getDb().prepare(
        `INSERT INTO provider_pauses (provider,until,updated_at) VALUES (?,?,?)
         ON CONFLICT(provider) DO UPDATE SET until=MAX(until,excluded.until),updated_at=excluded.updated_at`
    ).run(provider, until, Date.now());
}

/** Active pauses by provider (until, epoch ms). Expired ones are deleted on the way. */
export function getProviderPauses(now = Date.now()): Map<string, number> {
    const d = getDb();
    d.prepare(`DELETE FROM provider_pauses WHERE until<=?`).run(now);
    const rows = d.prepare(`SELECT provider, until FROM provider_pauses`).all() as { provider: string; until: number }[];
    return new Map(rows.map(r => [r.provider, r.until]));
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
    const changed = getDb().prepare(
        `UPDATE messages SET status='pending',retry_count=0,not_before=NULL,paused_ms=0,unknown_resets=0,updated_at=? WHERE id=? AND status='dead'`
    ).run(Date.now(), rowId).changes > 0;
    if (changed) queueEvents.emit('message:enqueued', { id: rowId });
    return changed;
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
    // messages row is pruned, and is never a background-lane session, which a
    // chat must not fork from.
    return getDb().prepare(
        `SELECT am.*, CASE WHEN m.lane='user' THEN m.session_id END AS sessionId
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
