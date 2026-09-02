import { Hono } from 'hono';
import {
    insertAutomationRule, updateAutomationRule, getAutomationRule,
    getAutomationRules, deleteAutomationRule,
    getAutomationRuns, getLastAutomationRun,
    parseTrigger, parseLegacyTrigger,
    getAutomationEngine,
} from '@fonte/torrent';
import { log, genId, getSettings, getAgents } from '@fonte/core';
import { ok, fail, requireEntity } from '../http';

const app = new Hono();
const requireRule = requireEntity(getAutomationRule, 'Automation rule');

interface RuleBody {
    name?: unknown;
    prompt?: unknown;
    trigger?: unknown;
    agent?: unknown;
    enabled?: unknown;
    triggerType?: unknown;
    triggerConfig?: unknown;
}

function resolveTrigger(body: RuleBody): { trigger: unknown } | { error: string } {
    if (body.trigger !== undefined) {
        return parseTrigger(body.trigger) ? { trigger: body.trigger } : { error: 'trigger is invalid' };
    }
    if (body.triggerType !== undefined) {
        const trigger = parseLegacyTrigger(body.triggerType, body.triggerConfig);
        return trigger ? { trigger } : { error: 'triggerType is not a known event, or the schedule cron is invalid' };
    }
    return { error: 'trigger is required' };
}

function resolveAgent(agent: unknown): string | { error: string } | undefined {
    if (agent === undefined || agent === null || agent === '') return undefined;
    if (typeof agent !== 'string') return { error: 'agent must be a string' };
    const agents = getAgents(getSettings());
    return agents[agent] ? agent : { error: `agent '${agent}' does not exist` };
}

app.get('/api/automations', (c) => {
    const enabled = c.req.query('enabled');
    const filter: { enabled?: boolean; agentId?: string; event?: string } = {};
    if (enabled === 'true') filter.enabled = true;
    if (enabled === 'false') filter.enabled = false;
    const agent = c.req.query('agent');
    if (agent) filter.agentId = agent;
    const event = c.req.query('event') ?? c.req.query('trigger');
    if (event) filter.event = event;

    const rules = getAutomationRules(filter).map(rule => ({ ...rule, lastRun: getLastAutomationRun(rule.id) ?? null }));
    return ok(c, { rules });
});

app.post('/api/automations', async (c) => {
    try {
        const body = await c.req.json() as RuleBody;
        if (typeof body.name !== 'string' || !body.name.trim()) return fail(c, 'name is required');
        if (typeof body.prompt !== 'string' || !body.prompt.trim()) return fail(c, 'prompt is required');
        const trigger = resolveTrigger(body);
        if ('error' in trigger) return fail(c, trigger.error);
        const agent = resolveAgent(body.agent);
        if (agent && typeof agent === 'object') return fail(c, agent.error);

        const id = genId('auto');
        insertAutomationRule({
            id,
            name: body.name.trim(),
            prompt: body.prompt.trim(),
            trigger: trigger.trigger,
            agentId: agent,
            enabled: body.enabled === undefined ? true : !!body.enabled,
        });
        return ok(c, { rule: getAutomationRule(id) });
    } catch (err) {
        const msg = (err as Error).message;
        log('ERROR', `[automations] Create failed: ${msg}`);
        return fail(c, msg);
    }
});

app.get('/api/automations/:id', requireRule, (c) => {
    const id = c.req.param('id');
    return ok(c, { rule: c.get('entity'), runs: getAutomationRuns(id) });
});

app.put('/api/automations/:id', requireRule, async (c) => {
    const id = c.req.param('id');
    try {
        const body = await c.req.json() as RuleBody;
        const fields: Parameters<typeof updateAutomationRule>[1] = {};
        if (body.name !== undefined) {
            if (typeof body.name !== 'string' || !body.name.trim()) return fail(c, 'name cannot be empty');
            fields.name = body.name.trim();
        }
        if (body.prompt !== undefined) {
            if (typeof body.prompt !== 'string' || !body.prompt.trim()) return fail(c, 'prompt cannot be empty');
            fields.prompt = body.prompt.trim();
        }
        if (body.trigger !== undefined || body.triggerType !== undefined) {
            const trigger = resolveTrigger(body);
            if ('error' in trigger) return fail(c, trigger.error);
            fields.trigger = trigger.trigger;
        }
        if (body.agent !== undefined) {
            const agent = resolveAgent(body.agent);
            if (agent && typeof agent === 'object') return fail(c, agent.error);
            if (agent) fields.agentId = agent;
        }
        if (body.enabled !== undefined) fields.enabled = !!body.enabled;

        updateAutomationRule(id, fields);
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

app.post('/api/automations/:id/pause', requireRule, (c) => {
    const id = c.req.param('id');
    updateAutomationRule(id, { enabled: false });
    return ok(c, { rule: getAutomationRule(id) });
});

app.post('/api/automations/:id/resume', requireRule, (c) => {
    const id = c.req.param('id');
    updateAutomationRule(id, { enabled: true });
    return ok(c, { rule: getAutomationRule(id) });
});

app.post('/api/automations/:id/trigger', requireRule, async (c) => {
    const rule = c.get('entity');
    try {
        const outcome = await getAutomationEngine().fire(rule, { trigger: 'manual' });
        if (outcome === 'skipped') return fail(c, `"${rule.name}" is still running`, 409);
        if (outcome === 'error') return fail(c, `"${rule.name}" could not be queued`, 500);
        return ok(c, { message: `Rule "${rule.name}" triggered`, runs: getAutomationRuns(rule.id) });
    } catch (err) {
        return fail(c, (err as Error).message, 500);
    }
});

app.get('/api/automations/:id/runs', requireRule, (c) => {
    const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!, 10) : 20;
    return ok(c, { runs: getAutomationRuns(c.req.param('id'), limit) });
});

export default app;
