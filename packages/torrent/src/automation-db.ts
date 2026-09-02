import fs from 'fs';
import { getDb } from './db-connection';
import {
    parseTrigger, parseLegacyTrigger, describeTrigger, nextRunAt, triggerEvents, triggerTypeColumn,
    type AutomationTrigger, type AutomationEventName,
} from './automation-trigger';

// ── Types ───────────────────────────────────────────────────────────────────

export const DEFAULT_AUTOMATION_AGENT = 'fonte';
const AUTOMATION_MAX_RUN_HISTORY = 20;
const AUTOMATION_MAX_RUN_DETAIL = 300;

export interface AutomationRule {
    id: string;
    name: string;
    prompt: string;
    trigger: AutomationTrigger;
    triggerDescription: string;
    agentId: string;
    enabled: boolean;
    lastTriggeredAt?: number;
    nextRunAt: number | null;
    triggerCount: number;
    createdAt: number;
    updatedAt: number;
}

export type AutomationRunTrigger = 'event' | 'schedule' | 'manual';
export type AutomationRunStatus = 'running' | 'ok' | 'error' | 'interrupted' | 'skipped';

export interface AutomationRun {
    id: string;
    ruleId: string;
    trigger: AutomationRunTrigger;
    eventSummary?: string;
    messageId: string;
    status: AutomationRunStatus;
    detail?: string;
    startedAt: number;
    finishedAt: number | null;
}

// ── Change notifications ────────────────────────────────────────────────────

type RulesListener = () => void;
const rulesListeners = new Set<RulesListener>();

/** Fires after any rule definition change (not after the engine's own run-count bumps). */
export function onAutomationRulesChanged(listener: RulesListener): () => void {
    rulesListeners.add(listener);
    return () => { rulesListeners.delete(listener); };
}

// The engine consults this on every emitted event, including the 3s torrent:stats
// tick, so it must not hit the DB per event.
let eventIndex: Map<AutomationEventName, string[]> | null = null;

function rulesChanged(): void {
    eventIndex = null;
    for (const listener of rulesListeners) {
        try { listener(); } catch { /* listeners never break a write */ }
    }
}

export function getEnabledEventIndex(): Map<AutomationEventName, string[]> {
    if (!eventIndex) {
        const index = new Map<AutomationEventName, string[]>();
        for (const rule of getAutomationRules({ enabled: true })) {
            for (const event of triggerEvents(rule.trigger)) {
                const ids = index.get(event) ?? [];
                ids.push(rule.id);
                index.set(event, ids);
            }
        }
        eventIndex = index;
    }
    return eventIndex;
}

// ── Rules CRUD ──────────────────────────────────────────────────────────────

function requireTrigger(value: unknown): AutomationTrigger {
    const trigger = parseTrigger(value);
    if (!trigger) throw new Error('trigger is invalid: expected an event, a cron schedule, a one-time run, or a group of those');
    return trigger;
}

export function insertAutomationRule(rule: {
    id: string;
    name: string;
    prompt: string;
    trigger: unknown;
    agentId?: string;
    enabled?: boolean;
    createdAt?: number;
}): void {
    const trigger = requireTrigger(rule.trigger);
    const now = Date.now();
    getDb().prepare(`
        INSERT INTO automation_rules (id, name, prompt, trigger, trigger_type, agent_id, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        rule.id,
        rule.name,
        rule.prompt,
        JSON.stringify(trigger),
        triggerTypeColumn(trigger),
        rule.agentId || DEFAULT_AUTOMATION_AGENT,
        rule.enabled === false ? 0 : 1,
        rule.createdAt ?? now,
        now,
    );
    rulesChanged();
}

export function updateAutomationRule(id: string, fields: Partial<{
    name: string;
    prompt: string;
    trigger: unknown;
    agentId: string;
    enabled: boolean;
    lastTriggeredAt: number;
    triggerCount: number;
}>): void {
    const sets: string[] = [];
    const values: any[] = [];

    if (fields.name !== undefined) { sets.push('name = ?'); values.push(fields.name); }
    if (fields.prompt !== undefined) { sets.push('prompt = ?'); values.push(fields.prompt); }
    if (fields.trigger !== undefined) {
        const trigger = requireTrigger(fields.trigger);
        sets.push('trigger = ?'); values.push(JSON.stringify(trigger));
        sets.push('trigger_type = ?'); values.push(triggerTypeColumn(trigger));
    }
    if (fields.agentId !== undefined) { sets.push('agent_id = ?'); values.push(fields.agentId); }
    if (fields.enabled !== undefined) { sets.push('enabled = ?'); values.push(fields.enabled ? 1 : 0); }
    if (fields.lastTriggeredAt !== undefined) { sets.push('last_triggered_at = ?'); values.push(fields.lastTriggeredAt); }
    if (fields.triggerCount !== undefined) { sets.push('trigger_count = ?'); values.push(fields.triggerCount); }

    if (sets.length === 0) return;
    sets.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);

    getDb().prepare(`UPDATE automation_rules SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    const definitionChanged = fields.name !== undefined || fields.prompt !== undefined
        || fields.trigger !== undefined || fields.agentId !== undefined || fields.enabled !== undefined;
    if (definitionChanged) rulesChanged();
}

export function getAutomationRule(id: string): AutomationRule | undefined {
    const row = getDb().prepare('SELECT * FROM automation_rules WHERE id = ?').get(id) as any;
    if (!row) return undefined;
    return rowToAutomationRule(row);
}

export function getAutomationRules(filter?: { enabled?: boolean; agentId?: string; event?: string }): AutomationRule[] {
    const conditions: string[] = [];
    const params: any[] = [];
    if (filter?.enabled !== undefined) { conditions.push('enabled = ?'); params.push(filter.enabled ? 1 : 0); }
    if (filter?.agentId) { conditions.push('agent_id = ?'); params.push(filter.agentId); }

    let sql = 'SELECT * FROM automation_rules';
    if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY created_at DESC';

    let rules = (getDb().prepare(sql).all(...params) as any[]).map(rowToAutomationRule);
    if (filter?.event) rules = rules.filter(r => (triggerEvents(r.trigger) as string[]).includes(filter.event!));
    return rules;
}

export function deleteAutomationRule(id: string): void {
    getDb().prepare('DELETE FROM automation_rules WHERE id = ?').run(id);
    rulesChanged();
}

// ── Runs ────────────────────────────────────────────────────────────────────

function clampRunDetail(detail: unknown): string | undefined {
    if (typeof detail !== 'string') return undefined;
    const text = detail.trim();
    return text ? text.slice(0, AUTOMATION_MAX_RUN_DETAIL) : undefined;
}

export function beginAutomationRun(run: {
    id: string;
    ruleId: string;
    trigger: AutomationRunTrigger;
    messageId: string;
    eventSummary?: string;
    status?: AutomationRunStatus;
    detail?: string;
}): AutomationRun {
    const now = Date.now();
    const status = run.status ?? 'running';
    const finishedAt = status === 'running' ? null : now;
    const db = getDb();
    db.prepare(`
        INSERT INTO automation_runs (id, rule_id, trigger, event_summary, message_id, status, detail, started_at, finished_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        run.id, run.ruleId, run.trigger, clampRunDetail(run.eventSummary) ?? null, run.messageId,
        status, clampRunDetail(run.detail) ?? null, now, finishedAt,
    );
    db.prepare(`
        DELETE FROM automation_runs WHERE rule_id = ? AND id NOT IN (
            SELECT id FROM automation_runs WHERE rule_id = ? ORDER BY started_at DESC LIMIT ?
        )
    `).run(run.ruleId, run.ruleId, AUTOMATION_MAX_RUN_HISTORY);
    return getAutomationRun(run.id)!;
}

export function finishAutomationRun(id: string, status: Exclude<AutomationRunStatus, 'running'>, detail?: string): AutomationRun | undefined {
    getDb().prepare(
        `UPDATE automation_runs SET status = ?, detail = COALESCE(?, detail), finished_at = ? WHERE id = ? AND status = 'running'`
    ).run(status, clampRunDetail(detail) ?? null, Date.now(), id);
    return getAutomationRun(id);
}

export function setAutomationRunDetail(id: string, detail: string): void {
    getDb().prepare(`UPDATE automation_runs SET detail = ? WHERE id = ? AND status = 'running'`).run(clampRunDetail(detail) ?? null, id);
}

export function getAutomationRun(id: string): AutomationRun | undefined {
    const row = getDb().prepare('SELECT * FROM automation_runs WHERE id = ?').get(id) as any;
    return row ? rowToAutomationRun(row) : undefined;
}

export function getAutomationRunByMessageId(messageId: string): AutomationRun | undefined {
    const row = getDb().prepare('SELECT * FROM automation_runs WHERE message_id = ? ORDER BY started_at DESC LIMIT 1').get(messageId) as any;
    return row ? rowToAutomationRun(row) : undefined;
}

export function getRunningAutomationRun(ruleId: string): AutomationRun | undefined {
    const row = getDb().prepare(
        `SELECT * FROM automation_runs WHERE rule_id = ? AND status = 'running' ORDER BY started_at DESC LIMIT 1`
    ).get(ruleId) as any;
    return row ? rowToAutomationRun(row) : undefined;
}

export function getAutomationRuns(ruleId: string, limit = AUTOMATION_MAX_RUN_HISTORY): AutomationRun[] {
    const rows = getDb().prepare(
        'SELECT * FROM automation_runs WHERE rule_id = ? ORDER BY started_at DESC LIMIT ?'
    ).all(ruleId, limit) as any[];
    return rows.map(rowToAutomationRun);
}

export function getLastAutomationRun(ruleId: string): AutomationRun | undefined {
    return getAutomationRuns(ruleId, 1)[0];
}

// ── Migrations ──────────────────────────────────────────────────────────────

export function backfillLegacyTriggers(): void {
    const db = getDb();
    const rows = db.prepare(
        `SELECT id, name, trigger_type, trigger_config FROM automation_rules WHERE trigger IS NULL OR trigger = ''`
    ).all() as { id: string; name: string; trigger_type: string; trigger_config: string }[];
    for (const row of rows) {
        let config: unknown = {};
        try { config = JSON.parse(row.trigger_config || '{}'); } catch { /* treat as empty */ }
        const trigger = parseLegacyTrigger(row.trigger_type, config);
        if (trigger) {
            db.prepare('UPDATE automation_rules SET trigger = ? WHERE id = ?').run(JSON.stringify(trigger), row.id);
        } else {
            // A schedule rule with no usable cron never fired; park it disabled with a
            // placeholder cron rather than invent a time it starts running.
            db.prepare('UPDATE automation_rules SET trigger = ?, enabled = 0 WHERE id = ?')
                .run(JSON.stringify({ type: 'cron', schedule: '0 9 * * 1-5' }), row.id);
        }
    }
    if (rows.length > 0) rulesChanged();
}

interface LegacySchedule {
    id?: string;
    label?: string;
    cron?: string;
    runAt?: string;
    agentId?: string;
    message?: string;
    enabled?: boolean;
    createdAt?: number;
}

/** The file is renamed afterwards so the import never repeats. */
export function importLegacySchedules(filePath: string): number {
    if (!fs.existsSync(filePath)) return 0;
    let schedules: LegacySchedule[];
    try {
        schedules = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (!Array.isArray(schedules)) schedules = [];
    } catch {
        schedules = [];
    }
    let imported = 0;
    for (const s of schedules) {
        if (!s.message || !s.agentId) continue;
        const id = `auto_sched_${s.id ?? `${Date.now()}_${imported}`}`.replace(/[^a-zA-Z0-9_-]/g, '_');
        if (getAutomationRule(id)) continue;
        const trigger = s.runAt ? { type: 'once', runAt: s.runAt } : s.cron ? { type: 'cron', schedule: s.cron } : null;
        if (!trigger || !parseTrigger(trigger)) continue;
        insertAutomationRule({
            id,
            name: s.label || s.message.slice(0, 40),
            prompt: s.message,
            trigger,
            agentId: s.agentId,
            enabled: s.enabled !== false,
            createdAt: s.createdAt,
        });
        imported += 1;
    }
    try { fs.renameSync(filePath, `${filePath}.imported`); } catch { /* leave the file; the ids dedupe a re-import */ }
    return imported;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function rowToAutomationRule(row: any): AutomationRule {
    let trigger = parseTrigger(safeJson(row.trigger));
    if (!trigger) trigger = parseLegacyTrigger(row.trigger_type, safeJson(row.trigger_config)) ?? { type: 'cron', schedule: '0 9 * * 1-5' };
    return {
        id: row.id,
        name: row.name,
        prompt: row.prompt ?? '',
        trigger,
        triggerDescription: describeTrigger(trigger),
        agentId: row.agent_id || DEFAULT_AUTOMATION_AGENT,
        enabled: !!row.enabled,
        lastTriggeredAt: row.last_triggered_at ?? undefined,
        nextRunAt: row.enabled ? nextRunAt(trigger) : null,
        triggerCount: row.trigger_count,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function rowToAutomationRun(row: any): AutomationRun {
    return {
        id: row.id,
        ruleId: row.rule_id,
        trigger: row.trigger,
        eventSummary: row.event_summary ?? undefined,
        messageId: row.message_id,
        status: row.status,
        detail: row.detail ?? undefined,
        startedAt: row.started_at,
        finishedAt: row.finished_at ?? null,
    };
}

function safeJson(text: unknown): unknown {
    if (typeof text !== 'string' || !text) return null;
    try { return JSON.parse(text); } catch { return null; }
}
