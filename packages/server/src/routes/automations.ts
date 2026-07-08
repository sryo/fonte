import { Hono } from 'hono';
import {
    insertAutomationRule, updateAutomationRule, getAutomationRule,
    getAutomationRules, deleteAutomationRule,
    getAutomationLogs,
    getAutomationEngine,
} from '@fonte/torrent';
import type { TriggerType } from '@fonte/torrent';
import { log, genId, getLastAssistantMessageByMessageIdPrefix } from '@fonte/core';
import { ok, fail } from '../http';

const app = new Hono();

app.get('/api/automations', (c) => {
    const enabled = c.req.query('enabled');
    const trigger = c.req.query('trigger');

    const filter: { enabled?: boolean; triggerType?: string } = {};
    if (enabled === 'true') filter.enabled = true;
    if (enabled === 'false') filter.enabled = false;
    if (trigger) filter.triggerType = trigger;

    const rules = getAutomationRules(filter);
    return ok(c, { rules });
});

app.post('/api/automations', async (c) => {
    try {
        const body = await c.req.json() as {
            name: string;
            prompt: string;
            triggerType: TriggerType;
            triggerConfig?: Record<string, unknown>;
        };

        if (!body.name) {
            return fail(c, 'name is required');
        }
        if (!body.triggerType) {
            return fail(c, 'triggerType is required');
        }
        if (!body.prompt) {
            return fail(c, 'prompt is required');
        }

        const id = genId('auto');
        insertAutomationRule({
            id,
            name: body.name,
            prompt: body.prompt,
            triggerType: body.triggerType,
            triggerConfig: body.triggerConfig,
        });

        const rule = getAutomationRule(id);
        return ok(c, { rule });
    } catch (err) {
        const msg = (err as Error).message;
        log('ERROR', `[automations] Create failed: ${msg}`);
        return fail(c, msg);
    }
});

app.get('/api/automations/:id', (c) => {
    const id = c.req.param('id');
    const rule = getAutomationRule(id);
    if (!rule) {
        return fail(c, 'Automation rule not found', 404);
    }
    const logs = getAutomationLogs(id, 20);
    const last = getLastAssistantMessageByMessageIdPrefix(`auto_${id}_`);
    const lastResponse = last ? { text: last.content as string, ts: last.created_at as number } : null;
    return ok(c, { rule, logs, lastResponse });
});

app.put('/api/automations/:id', async (c) => {
    const id = c.req.param('id');
    if (!getAutomationRule(id)) {
        return fail(c, 'Automation rule not found', 404);
    }
    try {
        const body = await c.req.json();
        updateAutomationRule(id, body);
        return ok(c, { rule: getAutomationRule(id) });
    } catch (err) {
        return fail(c, (err as Error).message);
    }
});

app.delete('/api/automations/:id', (c) => {
    const id = c.req.param('id');
    if (!getAutomationRule(id)) {
        return fail(c, 'Automation rule not found', 404);
    }
    deleteAutomationRule(id);
    return ok(c);
});

app.post('/api/automations/:id/toggle', (c) => {
    const id = c.req.param('id');
    const rule = getAutomationRule(id);
    if (!rule) {
        return fail(c, 'Automation rule not found', 404);
    }
    updateAutomationRule(id, { enabled: !rule.enabled });
    return ok(c, { rule: getAutomationRule(id) });
});

app.post('/api/automations/:id/trigger', async (c) => {
    const id = c.req.param('id');
    const rule = getAutomationRule(id);
    if (!rule) {
        return fail(c, 'Automation rule not found', 404);
    }

    try {
        const engine = getAutomationEngine();
        await engine.evaluateEvent(rule.triggerType, { manualTrigger: true, ruleId: id });
        return ok(c, { message: `Rule "${rule.name}" triggered` });
    } catch (err) {
        return fail(c, (err as Error).message, 500);
    }
});

app.get('/api/automations/:id/logs', (c) => {
    const id = c.req.param('id');
    if (!getAutomationRule(id)) {
        return fail(c, 'Automation rule not found', 404);
    }
    const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!, 10) : 50;
    const logs = getAutomationLogs(id, limit);
    return ok(c, { logs });
});

export default app;
