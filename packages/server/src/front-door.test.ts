import http from 'http';
import net from 'net';
import os from 'os';
import type { AddressInfo } from 'net';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { guardPolicy } from './request-guard';
import { frontDoorConfig, isLoopbackPeer, startFrontDoor, type FrontDoor } from './front-door';

interface Seen { method?: string; url?: string; host?: string }

function listen(server: http.Server, host = '127.0.0.1'): Promise<number> {
    return new Promise((resolve) => server.listen(0, host, () => resolve((server.address() as AddressInfo).port)));
}

function close(server: http.Server | net.Server): Promise<void> {
    return new Promise((resolve) => {
        (server as http.Server).closeAllConnections?.();
        server.close(() => resolve());
    });
}

function get(port: number, path: string, headers: Record<string, string> = {}, host = '127.0.0.1')
    : Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
    return new Promise((resolve, reject) => {
        const req = http.get({ host, port, path, headers: { host: 'fonte.localhost', ...headers } }, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (c) => { body += c; });
            res.on('end', () => resolve({ status: res.statusCode!, body, headers: res.headers }));
        });
        req.on('error', reject);
    });
}

let api: http.Server;
let next: http.Server;
let apiSeen: Seen[];
let nextSeen: Seen[];
let door: FrontDoor | null;

async function open(overrides: { apiPort?: number; dashboardPort?: number; host?: string } = {}): Promise<number> {
    const result = await startFrontDoor({
        port: 0,
        host: overrides.host ?? '127.0.0.1',
        apiPort: overrides.apiPort ?? (api.address() as AddressInfo).port,
        dashboardPort: overrides.dashboardPort ?? (next.address() as AddressInfo).port,
        policy: guardPolicy('127.0.0.1', {}),
    });
    if (!result.bound) throw new Error(result.error);
    door = result.door;
    return result.door.port;
}

beforeEach(async () => {
    apiSeen = [];
    nextSeen = [];
    door = null;
    api = http.createServer((req, res) => {
        apiSeen.push({ method: req.method, url: req.url, host: req.headers.host });
        if (req.url === '/api/events/stream') {
            res.writeHead(200, { 'content-type': 'text/event-stream' });
            res.write('event: connected\ndata: {}\n\n');
            return;
        }
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ from: 'api', url: req.url, body }));
        });
    });
    next = http.createServer((req, res) => {
        nextSeen.push({ method: req.method, url: req.url, host: req.headers.host });
        res.writeHead(req.url === '/missing' ? 404 : 200, { 'content-type': 'text/html', 'x-next': '1' });
        res.end(`<p>next ${req.url}</p>`);
    });
    await listen(api);
    await listen(next);
});

afterEach(async () => {
    if (door) await door.close();
    await close(api);
    await close(next);
});

describe('isLoopbackPeer', () => {
    it('accepts IPv4, IPv6 and IPv4-mapped loopback', () => {
        expect(isLoopbackPeer('127.0.0.1')).toBe(true);
        expect(isLoopbackPeer('127.8.9.10')).toBe(true);
        expect(isLoopbackPeer('::1')).toBe(true);
        expect(isLoopbackPeer('::ffff:127.0.0.1')).toBe(true);
    });

    it('rejects LAN and missing addresses', () => {
        expect(isLoopbackPeer('192.168.1.20')).toBe(false);
        expect(isLoopbackPeer('::ffff:192.168.1.20')).toBe(false);
        expect(isLoopbackPeer('fe80::1')).toBe(false);
        expect(isLoopbackPeer(undefined)).toBe(false);
    });
});

describe('front door routing', () => {
    it('sends /api to the daemon and nothing to the dashboard', async () => {
        const port = await open();
        const res = await get(port, '/api/status?x=1');
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toMatchObject({ from: 'api', url: '/api/status?x=1' });
        expect(nextSeen).toHaveLength(0);
        expect(apiSeen[0].host).toBe('fonte.localhost');
    });

    it('forwards request bodies to the daemon', async () => {
        const port = await open();
        const body = await new Promise<string>((resolve, reject) => {
            const req = http.request({ host: '127.0.0.1', port, path: '/api/messages', method: 'POST',
                headers: { host: 'fonte.localhost', 'content-type': 'application/json' } }, (res) => {
                let b = '';
                res.on('data', (c) => { b += c; });
                res.on('end', () => resolve(b));
            });
            req.on('error', reject);
            req.end('{"message":"hi"}');
        });
        expect(JSON.parse(body)).toMatchObject({ from: 'api', body: '{"message":"hi"}' });
        expect(apiSeen[0].method).toBe('POST');
    });

    it('sends everything else to the dashboard with path, status and headers intact', async () => {
        const port = await open();
        const page = await get(port, '/library?kind=tv');
        expect(page.status).toBe(200);
        expect(page.body).toBe('<p>next /library?kind=tv</p>');
        expect(page.headers['x-next']).toBe('1');
        expect((await get(port, '/missing')).status).toBe(404);
        expect(apiSeen).toHaveLength(0);
    });

    it('does not treat /apiary as the API', async () => {
        const port = await open();
        await get(port, '/apiary');
        expect(nextSeen[0].url).toBe('/apiary');
        expect(apiSeen).toHaveLength(0);
    });

    it('streams SSE without waiting for the response to end', async () => {
        const port = await open();
        const first = await new Promise<string>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('no SSE event within 500ms')), 500);
            const req = http.get({ host: '127.0.0.1', port, path: '/api/events/stream', headers: { host: 'fonte.localhost' } }, (res) => {
                res.setEncoding('utf8');
                res.once('data', (chunk) => {
                    clearTimeout(timer);
                    req.destroy();
                    resolve(chunk);
                });
            });
            req.on('error', () => {});
        });
        expect(first).toContain('event: connected');
    });

    it('refuses a foreign Host before proxying anywhere', async () => {
        const port = await open();
        const res = await get(port, '/library', { host: 'attacker.example' });
        expect(res.status).toBe(403);
        expect(nextSeen).toHaveLength(0);
        expect(apiSeen).toHaveLength(0);
    });

    it('answers 502 with a readable message when the dashboard is down', async () => {
        const port = await open({ dashboardPort: await unusedPort() });
        const res = await get(port, '/');
        expect(res.status).toBe(502);
        expect(res.body).toMatch(/dashboard/i);
    });
});

describe('front door peers', () => {
    const lan = Object.values(os.networkInterfaces()).flat()
        .find((i) => i && i.family === 'IPv4' && !i.internal)?.address;

    it.skipIf(!lan)('drops connections that do not come from this machine', async () => {
        const port = await open({ host: '::' });
        await expect(get(port, '/', {}, lan)).rejects.toThrow();
        expect(nextSeen).toHaveLength(0);
        expect((await get(port, '/')).status).toBe(200);
    });
});

describe('front door bind', () => {
    it('reports a taken port instead of throwing', async () => {
        const blocker = net.createServer();
        const taken = await new Promise<number>((resolve) =>
            blocker.listen(0, '127.0.0.1', () => resolve((blocker.address() as AddressInfo).port)));
        try {
            const result = await startFrontDoor({
                port: taken, host: '127.0.0.1', apiPort: 1, dashboardPort: 1, policy: guardPolicy('127.0.0.1', {}),
            });
            expect(result).toEqual({ bound: false, port: taken, error: 'EADDRINUSE' });
        } finally {
            await close(blocker);
        }
    });
});

async function unusedPort(): Promise<number> {
    const s = net.createServer();
    const port = await new Promise<number>((resolve) => s.listen(0, '127.0.0.1', () => resolve((s.address() as AddressInfo).port)));
    await close(s);
    return port;
}

describe('frontDoorConfig', () => {
    it('defaults to :80 on the dual-stack wildcard, fronting the daemon and dashboard on 3000', () => {
        expect(frontDoorConfig({}, 3777)).toEqual({ port: 80, host: '::', apiPort: 3777, dashboardPort: 3000 });
    });

    it('follows FONTE_FRONT_DOOR_PORT and FONTE_DASHBOARD_PORT', () => {
        expect(frontDoorConfig({ FONTE_FRONT_DOOR_PORT: '8080', FONTE_DASHBOARD_PORT: '3100' }, 3901))
            .toEqual({ port: 8080, host: '::', apiPort: 3901, dashboardPort: 3100 });
    });

    it('is off when FONTE_FRONT_DOOR_PORT is off or not a port', () => {
        expect(frontDoorConfig({ FONTE_FRONT_DOOR_PORT: 'off' }, 3777)).toBeNull();
        expect(frontDoorConfig({ FONTE_FRONT_DOOR_PORT: 'eighty' }, 3777)).toBeNull();
    });
});
