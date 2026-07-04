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
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export const ok = (c: Context, payload: Record<string, unknown> = {}) =>
    c.json({ ok: true, ...payload });

export const fail = (c: Context, error: string, status: ContentfulStatusCode = 400) =>
    c.json({ ok: false, error }, status);
