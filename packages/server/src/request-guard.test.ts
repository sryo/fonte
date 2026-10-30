import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { guardPolicy, hostOf, isAllowedOrigin, requestGuard } from './request-guard';

function appWith(bindHost = '127.0.0.1', env: NodeJS.ProcessEnv = {}) {
    const app = new Hono();
    app.use('/*', requestGuard(guardPolicy(bindHost, env)));
    app.get('/api/x', (c) => c.json({ ok: true }));
    app.post('/api/x', (c) => c.json({ ok: true }));
    return app;
}

const post = (headers: Record<string, string>) =>
    ({ method: 'POST', headers: { host: '127.0.0.1:3777', ...headers }, body: '{"message":"hi"}' });

describe('hostOf', () => {
    it('drops the port and IPv6 brackets', () => {
        expect(hostOf('localhost:3777')).toBe('localhost');
        expect(hostOf('[::1]:3777')).toBe('::1');
        expect(hostOf('Example.COM')).toBe('example.com');
    });
});

describe('requestGuard', () => {
    it('lets curl and the CLI through (no Origin)', async () => {
        const res = await appWith().request('/api/x', post({}));
        expect(res.status).toBe(200);
    });

    it('lets the dashboard through', async () => {
        const res = await appWith().request('/api/x', post({ origin: 'http://localhost:3000' }));
        expect(res.status).toBe(200);
    });

    it('refuses a text/plain POST from another site', async () => {
        const res = await appWith().request('/api/x', post({ origin: 'https://evil.example', 'content-type': 'text/plain' }));
        expect(res.status).toBe(403);
    });

    it('refuses the null origin of sandboxed frames and file pages', async () => {
        const res = await appWith().request('/api/x', post({ origin: 'null' }));
        expect(res.status).toBe(403);
    });

    it('refuses a rebound hostname even on GET', async () => {
        const res = await appWith().request('/api/x', { headers: { host: 'attacker.example:3777' } });
        expect(res.status).toBe(403);
    });

    it('allows reads from another origin, which CORS then hides', async () => {
        const res = await appWith().request('/api/x', { headers: { host: 'localhost:3777', origin: 'https://evil.example' } });
        expect(res.status).toBe(200);
    });

    it('accepts a specific bind address and configured extras', async () => {
        const app = appWith('192.168.1.5', { FONTE_ALLOWED_HOSTS: 'mac.tailnet.ts.net', FONTE_ALLOWED_ORIGINS: 'https://mac.tailnet.ts.net' });
        expect((await app.request('/api/x', { headers: { host: '192.168.1.5:3777' } })).status).toBe(200);
        expect((await app.request('/api/x', {
            method: 'POST', headers: { host: 'mac.tailnet.ts.net', origin: 'https://mac.tailnet.ts.net' },
        })).status).toBe(200);
    });

    it('does not treat a wildcard bind as a hostname', () => {
        expect(guardPolicy('0.0.0.0').hosts.has('0.0.0.0')).toBe(false);
    });
});

describe('isAllowedOrigin', () => {
    const policy = guardPolicy('127.0.0.1', {});
    it('accepts loopback origins on any port', () => {
        expect(isAllowedOrigin('http://127.0.0.1:3000', policy)).toBe(true);
        expect(isAllowedOrigin('http://[::1]:3000', policy)).toBe(true);
    });
    it('rejects lookalikes', () => {
        expect(isAllowedOrigin('http://localhost.evil.example', policy)).toBe(false);
        expect(isAllowedOrigin('file://', policy)).toBe(false);
    });
});
