import os from 'os';
import path from 'path';
import { Hono } from 'hono';
import {
    getAgentMessages, deleteAgentMessagesFrom, requestAgentReset, getSettings,
} from '@fonte/core';
import { ok, fail } from '../http';

const app = new Hono();

app.get('/api/agents/:id/messages', (c) => {
    const agentId = c.req.param('id');
    const limit = parseInt(c.req.query('limit') || '200', 10);
    const sinceId = parseInt(c.req.query('since_id') || '0', 10);

    return ok(c, { messages: getAgentMessages(agentId, limit, sinceId > 0 ? sinceId : 0) });
});

// Edit-and-rerun truncation: drops the row and everything after it.
app.delete('/api/agents/:id/messages', (c) => {
    const from = parseInt(c.req.query('from') || '', 10);
    if (!Number.isFinite(from)) return fail(c, 'from query param required', 400);
    const deleted = deleteAgentMessagesFrom(c.req.param('id'), from);
    return ok(c, { deleted });
});

app.post('/api/agents/:id/reset', (c) => {
    const settings = getSettings();
    const workspacePath = settings?.workspace?.path || path.join(os.homedir(), 'fonte-workspace');
    requestAgentReset(c.req.param('id'), workspacePath);
    return ok(c);
});

export default app;
