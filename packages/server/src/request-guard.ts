import type { MiddlewareHandler } from 'hono';
import { fail } from './http';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const WILDCARD_BINDS = new Set(['0.0.0.0', '::', '']);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function envList(value: string | undefined): string[] {
    return (value ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

/** Hostname of a Host header without its port; IPv6 brackets stripped. */
export function hostOf(header: string): string {
    const h = header.trim().toLowerCase();
    if (h.startsWith('[')) return h.slice(1, h.indexOf(']'));
    const colon = h.lastIndexOf(':');
    return colon === -1 ? h : h.slice(0, colon);
}

export interface GuardPolicy {
    hosts: Set<string>;
    origins: Set<string>;
}

/**
 * Loopback names, plus the bind address when it is a specific non-loopback
 * one, plus FONTE_ALLOWED_HOSTS / FONTE_ALLOWED_ORIGINS for anything else.
 */
export function guardPolicy(bindHost: string, env: NodeJS.ProcessEnv = process.env): GuardPolicy {
    const hosts = new Set([...LOOPBACK_HOSTS, ...envList(env.FONTE_ALLOWED_HOSTS)]);
    const bind = bindHost.trim().toLowerCase();
    if (!WILDCARD_BINDS.has(bind)) hosts.add(bind);
    return { hosts, origins: new Set(envList(env.FONTE_ALLOWED_ORIGINS)) };
}

export function isAllowedOrigin(origin: string, policy: GuardPolicy): boolean {
    if (policy.origins.has(origin.toLowerCase())) return true;
    try {
        const url = new URL(origin);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
        return LOOPBACK_HOSTS.has(hostOf(url.host));
    } catch {
        return false;
    }
}

/**
 * CORS only hides responses from other sites; the request itself still runs.
 * So a foreign Host (DNS rebinding) is refused outright, and a state-changing
 * request that a browser tagged with a foreign Origin never reaches a route.
 * curl and the CLI send no Origin and pass.
 */
export function requestGuard(policy: GuardPolicy): MiddlewareHandler {
    return async (c, next) => {
        const host = c.req.header('host');
        if (host && !policy.hosts.has(hostOf(host))) {
            return fail(c, 'Host not allowed', 403);
        }
        if (!SAFE_METHODS.has(c.req.method)) {
            const origin = c.req.header('origin');
            if (origin !== undefined && !isAllowedOrigin(origin, policy)) {
                return fail(c, 'Origin not allowed', 403);
            }
        }
        await next();
    };
}
