import { Hono } from 'hono';
import {
    insertAutomationRule, updateAutomationRule, getAutomationRule,
    getAutomationRules, deleteAutomationRule,
    getAutomationLogs,
    getAutomationEngine,
} from '@fonte/torrent';
import type { TriggerType } from '@fonte/torrent';
import { log, genId, getLastAssistantMessageByMessageIdPrefix } from '@fonte/core';
import { ok, fail, requireEntity } from '../http';

const app = new Hono();
const requireRule = requireEntity(getAutomationRule, 'Automation rule');

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

app.get('/api/automations/:id', requireRule, (c) => {
    const id = c.req.param('id');
    const logs = getAutomationLogs(id, 20);
    const last = getLastAssistantMessageByMessageIdPrefix(`auto_${id}_`);
    const lastResponse = last ? { text: last.content as string, ts: last.created_at as number } : null;
    return ok(c, { rule: c.get('entity'), logs, lastResponse });
});

app.put('/api/automations/:id', requireRule, async (c) => {
    const id = c.req.param('id');
    try {
        const body = await c.req.json();
        updateAutomationRule(id, body);
        return ok(c, { rule: getAutomationRule(id) });
    } catch (err) {
        return fail(c, (err as Error).message);
    }
});

app.delete('/api/automations/:id', requireRule, (c) => {
    deleteAutomationRule(c.req.param('id'));
    return ok(c);
});

app.post('/api/automations/:id/toggle', requireRule, (c) => {
    const id = c.req.param('id');
    updateAutomationRule(id, { enabled: !c.get('entity').enabled });
    return ok(c, { rule: getAutomationRule(id) });
});

app.post('/api/automations/:id/trigger', requireRule, async (c) => {
    const rule = c.get('entity');
    try {
        const engine = getAutomationEngine();
        await engine.evaluateEvent(rule.triggerType, { manualTrigger: true, ruleId: rule.id });
        return ok(c, { message: `Rule "${rule.name}" triggered` });
    } catch (err) {
        return fail(c, (err as Error).message, 500);
    }
});

app.get('/api/automations/:id/logs', requireRule, (c) => {
    const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!, 10) : 50;
    const logs = getAutomationLogs(c.req.param('id'), limit);
    return ok(c, { logs });
});

export default app;
