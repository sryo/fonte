/**
 * Response envelope helpers — the API-wide wire contract.
 *
 * Success: { ok: true, <domainKey>: payload }
 * Error:   { ok: false, error: string } with a meaningful HTTP status.
 *
 * Payload keys are spread into the envelope, so callers must pass named
 * domain keys (e.g. { torrents }) — never a bare record whose keys could
 * collide with `ok` or read as phantom entries when iterated.
 */

import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export const ok = (c: Context, payload: Record<string, unknown> = {}) =>
    c.json({ ok: true, ...payload });

export const fail = (c: Context, error: string, status: ContentfulStatusCode = 400) =>
    c.json({ ok: false, error }, status);

/**
 * 404-guard for `/:id` routes: resolves the entity before the handler runs
 * and stashes it on the context, replacing per-handler lookup-or-404 blocks.
 * Handlers read it back with `c.get('entity')`.
 */
export const requireEntity = <T>(lookup: (id: string) => T | undefined | null, what: string) =>
    createMiddleware<{ Variables: { entity: T } }>(async (c, next) => {
        const entity = lookup(c.req.param('id') ?? '');
        if (!entity) return fail(c, `${what} not found`, 404);
        c.set('entity', entity);
        await next();
    });
