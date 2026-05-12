import { getDb } from './db-connection';

// ── Types ───────────────────────────────────────────────────────────────────

export type TriggerType =
    | 'torrent:completed' | 'torrent:added' | 'torrent:error' | 'torrent:stalled'
    | 'watchlist:match' | 'watchlist:search'
    | 'subtitle:downloaded' | 'subtitle:translated'
    | 'schedule';

export type ActionType =
    | 'add_torrent' | 'pause_torrent' | 'remove_torrent' | 'resume_torrent'
    | 'fetch_subtitles' | 'translate_subtitles'
    | 'notify_webhook';

export interface AutomationCondition {
    field: string;
    operator: string;
    value: string | number;
}

export interface AutomationAction {
    type: ActionType;
    config: Record<string, unknown>;
}

export interface AutomationRule {
    id: string;
    name: string;
    description: string;
    triggerType: TriggerType;
    triggerConfig: Record<string, unknown>;
    conditions: AutomationCondition[];
    actions: AutomationAction[];
    enabled: boolean;
    lastTriggeredAt?: number;
    triggerCount: number;
    createdAt: number;
    updatedAt: number;
}

export interface AutomationLog {
    id: number;
    ruleId: string;
    triggerEvent: string;
    conditionsMet: boolean;
    actionsExecuted: string[];
    errorMessage?: string;
    executedAt: number;
}

// ── Automation Rules CRUD ───────────────────────────────────────────────────

export function insertAutomationRule(rule: {
    id: string;
    name: string;
    description?: string;
    triggerType: TriggerType;
    triggerConfig?: Record<string, unknown>;
    conditions?: AutomationCondition[];
    actions?: AutomationAction[];
}): void {
    const now = Date.now();
    getDb().prepare(`
        INSERT INTO automation_rules (id, name, description, trigger_type, trigger_config, conditions, actions, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        rule.id,
        rule.name,
        rule.description ?? '',
        rule.triggerType,
        JSON.stringify(rule.triggerConfig ?? {}),
        JSON.stringify(rule.conditions ?? []),
        JSON.stringify(rule.actions ?? []),
        now,
        now,
    );
}

export function updateAutomationRule(id: string, fields: Partial<{
    name: string;
    description: string;
    triggerType: TriggerType;
    triggerConfig: Record<string, unknown>;
    conditions: AutomationCondition[];
    actions: AutomationAction[];
    enabled: boolean;
    lastTriggeredAt: number;
    triggerCount: number;
}>): void {
    const sets: string[] = [];
    const values: any[] = [];

    if (fields.name !== undefined) { sets.push('name = ?'); values.push(fields.name); }
    if (fields.description !== undefined) { sets.push('description = ?'); values.push(fields.description); }
    if (fields.triggerType !== undefined) { sets.push('trigger_type = ?'); values.push(fields.triggerType); }
    if (fields.triggerConfig !== undefined) { sets.push('trigger_config = ?'); values.push(JSON.stringify(fields.triggerConfig)); }
    if (fields.conditions !== undefined) { sets.push('conditions = ?'); values.push(JSON.stringify(fields.conditions)); }
    if (fields.actions !== undefined) { sets.push('actions = ?'); values.push(JSON.stringify(fields.actions)); }
    if (fields.enabled !== undefined) { sets.push('enabled = ?'); values.push(fields.enabled ? 1 : 0); }
    if (fields.lastTriggeredAt !== undefined) { sets.push('last_triggered_at = ?'); values.push(fields.lastTriggeredAt); }
    if (fields.triggerCount !== undefined) { sets.push('trigger_count = ?'); values.push(fields.triggerCount); }

    if (sets.length === 0) return;
    sets.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);

    getDb().prepare(`UPDATE automation_rules SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function getAutomationRule(id: string): AutomationRule | undefined {
    const row = getDb().prepare('SELECT * FROM automation_rules WHERE id = ?').get(id) as any;
    if (!row) return undefined;
    return rowToAutomationRule(row);
}

export function getAutomationRules(filter?: { enabled?: boolean; triggerType?: string }): AutomationRule[] {
    let sql = 'SELECT * FROM automation_rules';
    const conditions: string[] = [];
    const params: any[] = [];

    if (filter?.enabled !== undefined) {
        conditions.push('enabled = ?');
        params.push(filter.enabled ? 1 : 0);
    }
    if (filter?.triggerType) {
        conditions.push('trigger_type = ?');
        params.push(filter.triggerType);
    }

    if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY created_at DESC';

    const rows = getDb().prepare(sql).all(...params) as any[];
    return rows.map(rowToAutomationRule);
}

export function deleteAutomationRule(id: string): void {
    getDb().prepare('DELETE FROM automation_rules WHERE id = ?').run(id);
}

// ── Automation Logs ─────────────────────────────────────────────────────────

export function insertAutomationLog(log: {
    ruleId: string;
    triggerEvent: string;
    conditionsMet: boolean;
    actionsExecuted?: string[];
    errorMessage?: string;
}): void {
    const now = Date.now();
    getDb().prepare(`
        INSERT INTO automation_logs (rule_id, trigger_event, conditions_met, actions_executed, error_message, executed_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(
        log.ruleId,
        log.triggerEvent,
        log.conditionsMet ? 1 : 0,
        JSON.stringify(log.actionsExecuted ?? []),
        log.errorMessage ?? null,
        now,
    );
}

export function getAutomationLogs(ruleId: string, limit?: number): AutomationLog[] {
    let sql = 'SELECT * FROM automation_logs WHERE rule_id = ? ORDER BY executed_at DESC';
    const params: any[] = [ruleId];

    if (limit) {
        sql += ' LIMIT ?';
        params.push(limit);
    }

    const rows = getDb().prepare(sql).all(...params) as any[];
    return rows.map(rowToAutomationLog);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function rowToAutomationRule(row: any): AutomationRule {
    return {
        id: row.id,
        name: row.name,
        description: row.description ?? '',
        triggerType: row.trigger_type as TriggerType,
        triggerConfig: JSON.parse(row.trigger_config || '{}'),
        conditions: JSON.parse(row.conditions || '[]'),
        actions: JSON.parse(row.actions || '[]'),
        enabled: !!row.enabled,
        lastTriggeredAt: row.last_triggered_at ?? undefined,
        triggerCount: row.trigger_count,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function rowToAutomationLog(row: any): AutomationLog {
    return {
        id: row.id,
        ruleId: row.rule_id,
        triggerEvent: row.trigger_event,
        conditionsMet: !!row.conditions_met,
        actionsExecuted: JSON.parse(row.actions_executed || '[]'),
        errorMessage: row.error_message ?? undefined,
        executedAt: row.executed_at,
    };
}
