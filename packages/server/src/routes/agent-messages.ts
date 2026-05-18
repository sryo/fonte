import { Hono } from 'hono';
import { getAgentMessages } from '@fonte/core';

const app = new Hono();

app.get('/api/agents/:id/messages', (c) => {
    const agentId = c.req.param('id');
    const limit = parseInt(c.req.query('limit') || '200', 10);
    const sinceId = parseInt(c.req.query('since_id') || '0', 10);

    let messages = getAgentMessages(agentId, limit);
    if (sinceId > 0) {
        messages = messages.filter((m: any) => m.id > sinceId);
    }

    return c.json(messages);
});

export default app;
