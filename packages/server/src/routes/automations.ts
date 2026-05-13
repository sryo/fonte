import { Hono } from 'hono';
import {
    insertAutomationRule, updateAutomationRule, getAutomationRule,
    getAutomationRules, deleteAutomationRule,
    getAutomationLogs,
    getAutomationEngine,
} from '@aitorrent/torrent';
import type { TriggerType } from '@aitorrent/torrent';
import { log, genId } from '@aitorrent/core';

const app = new Hono();

// GET /api/automations — list rules
app.get('/api/automations', (c) => {
    const enabled = c.req.query('enabled');
    const trigger = c.req.query('trigger');

    const filter: { enabled?: boolean; triggerType?: string } = {};
    if (enabled === 'true') filter.enabled = true;
    if (enabled === 'false') filter.enabled = false;
    if (trigger) filter.triggerType = trigger;

    const rules = getAutomationRules(filter);
    return c.json({ ok: true, rules });
});

// POST /api/automations — create rule
app.post('/api/automations', async (c) => {
    try {
        const body = await c.req.json() as {
            name: string;
            prompt: string;
            triggerType: TriggerType;
            triggerConfig?: Record<string, unknown>;
        };

        if (!body.name) {
            return c.json({ ok: false, error: 'name is required' }, 400);
        }
        if (!body.triggerType) {
            return c.json({ ok: false, error: 'triggerType is required' }, 400);
        }
        if (!body.prompt) {
            return c.json({ ok: false, error: 'prompt is required' }, 400);
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
        return c.json({ ok: true, rule });
    } catch (err) {
        const msg = (err as Error).message;
        log('ERROR', `[automations] Create failed: ${msg}`);
        return c.json({ ok: false, error: msg }, 400);
    }
});

// GET /api/automations/:id — get rule + recent logs
app.get('/api/automations/:id', (c) => {
    const id = c.req.param('id');
    const rule = getAutomationRule(id);
    if (!rule) {
        return c.json({ ok: false, error: 'Automation rule not found' }, 404);
    }
    const logs = getAutomationLogs(id, 20);
    return c.json({ ok: true, rule, logs });
});

// PUT /api/automations/:id — update rule
app.put('/api/automations/:id', async (c) => {
    const id = c.req.param('id');
    if (!getAutomationRule(id)) {
        return c.json({ ok: false, error: 'Automation rule not found' }, 404);
    }
    try {
        const body = await c.req.json();
        updateAutomationRule(id, body);
        return c.json({ ok: true, rule: getAutomationRule(id) });
    } catch (err) {
        return c.json({ ok: false, error: (err as Error).message }, 400);
    }
});

// DELETE /api/automations/:id — delete rule
app.delete('/api/automations/:id', (c) => {
    const id = c.req.param('id');
    if (!getAutomationRule(id)) {
        return c.json({ ok: false, error: 'Automation rule not found' }, 404);
    }
    deleteAutomationRule(id);
    return c.json({ ok: true });
});

// POST /api/automations/:id/toggle — toggle enabled/disabled
app.post('/api/automations/:id/toggle', (c) => {
    const id = c.req.param('id');
    const rule = getAutomationRule(id);
    if (!rule) {
        return c.json({ ok: false, error: 'Automation rule not found' }, 404);
    }
    updateAutomationRule(id, { enabled: !rule.enabled });
    return c.json({ ok: true, rule: getAutomationRule(id) });
});

// POST /api/automations/:id/trigger — manually trigger
app.post('/api/automations/:id/trigger', async (c) => {
    const id = c.req.param('id');
    const rule = getAutomationRule(id);
    if (!rule) {
        return c.json({ ok: false, error: 'Automation rule not found' }, 404);
    }

    try {
        const engine = getAutomationEngine();
        await engine.evaluateEvent(rule.triggerType, { manualTrigger: true, ruleId: id });
        return c.json({ ok: true, message: `Rule "${rule.name}" triggered` });
    } catch (err) {
        return c.json({ ok: false, error: (err as Error).message }, 500);
    }
});

// GET /api/automations/:id/logs — get execution logs
app.get('/api/automations/:id/logs', (c) => {
    const id = c.req.param('id');
    if (!getAutomationRule(id)) {
        return c.json({ ok: false, error: 'Automation rule not found' }, 404);
    }
    const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!, 10) : 50;
    const logs = getAutomationLogs(id, limit);
    return c.json({ ok: true, logs });
});

export default app;
