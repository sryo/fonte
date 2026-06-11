/**
 * API Server — HTTP endpoints for Mission Control and external integrations.
 *
 * Runs on a configurable port (env FONTE_API_PORT, default 3777) and
 * provides REST + SSE access to agents, teams, settings, queue status,
 * events, logs, and chat histories.
 */

import http from 'http';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { RESPONSE_ALREADY_SENT } from '@hono/node-server/utils/response';
import { log } from '@fonte/core';
import { addSSEClient, removeSSEClient } from './sse';

import messagesRoutes from './routes/messages';
import agentsRoutes from './routes/agents';
import settingsRoutes from './routes/settings';
import { createQueueRoutes } from './routes/queue';
import logsRoutes from './routes/logs';
import { createServicesRoutes, type ServiceHandlers } from './routes/services';
export type { ServiceHandlers } from './routes/services';
import agentMessagesRoutes from './routes/agent-messages';
import schedulesRoutes from './routes/schedules';
import torrentsRoutes from './routes/torrents';
import watchlistRoutes from './routes/watchlist';
import indexersRoutes from './routes/indexers';
import subtitlesRoutes from './routes/subtitles';
import automationsRoutes from './routes/automations';
import whatsappRoutes from './routes/whatsapp';

const API_PORT = parseInt(process.env.FONTE_API_PORT || '3777', 10);
// Loopback-only by default: the API has no authentication, so exposing it
// beyond this machine (or to arbitrary web origins) hands out full control.
const API_HOST = process.env.FONTE_API_HOST || '127.0.0.1';

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const startedAt = Date.now();

/**
 * Create and start the API server.
 *
 * @param services - Optional service handler callbacks for channel/heartbeat management.
 * @returns The http.Server instance (for graceful shutdown).
 */
export function startApiServer(services?: ServiceHandlers): http.Server {
    const app = new Hono();

    // CORS middleware
    app.use('/*', cors({
        origin: (origin) => (LOCAL_ORIGIN.test(origin) ? origin : null),
    }));

    // Mount route modules
    app.route('/', messagesRoutes);
    app.route('/', agentsRoutes);
    app.route('/', settingsRoutes);
    app.route('/', createQueueRoutes());
    app.route('/', logsRoutes);
    app.route('/', agentMessagesRoutes);
    app.route('/', createServicesRoutes(services));
    app.route('/', schedulesRoutes);
    app.route('/', torrentsRoutes);
    app.route('/', watchlistRoutes);
    app.route('/', indexersRoutes);
    app.route('/', subtitlesRoutes);
    app.route('/', automationsRoutes);
    app.route('/', whatsappRoutes);

    // GET /api/status — overall system status
    app.get('/api/status', (c) => {
        return c.json({
            ok: true,
            uptime: Math.floor((Date.now() - startedAt) / 1000),
            server: { running: true, port: API_PORT },
        });
    });

    // SSE endpoint — needs raw Node.js response for streaming
    app.get('/api/events/stream', (c) => {
        const nodeRes = (c.env as { outgoing: http.ServerResponse }).outgoing;
        const origin = c.req.header('origin');
        nodeRes.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            ...(origin && LOCAL_ORIGIN.test(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
        });
        nodeRes.write(`event: connected\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`);
        addSSEClient(nodeRes);
        nodeRes.on('close', () => removeSSEClient(nodeRes));
        return RESPONSE_ALREADY_SENT;
    });

    // 404 fallback
    app.notFound((c) => {
        return c.json({ error: 'Not found' }, 404);
    });

    // Error handler
    app.onError((err, c) => {
        log('ERROR', `[API] ${err.message}`);
        return c.json({ error: 'Internal server error' }, 500);
    });

    const server = serve({
        fetch: app.fetch,
        port: API_PORT,
        hostname: API_HOST,
    }, () => {
        log('INFO', `API server listening on http://${API_HOST}:${API_PORT}`);
    });

    return server as unknown as http.Server;
}
