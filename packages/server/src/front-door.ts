import http from 'http';
import net from 'net';
import { isAllowedHost, type GuardPolicy } from './request-guard';

export interface FrontDoorOptions {
    port: number;
    /** macOS lets an unprivileged process bind :80 only on the wildcard address. */
    host: string;
    apiPort: number;
    dashboardPort: number;
    policy: GuardPolicy;
}

export interface FrontDoor {
    port: number;
    close(): Promise<void>;
}

export type FrontDoorResult =
    | { bound: true; port: number; door: FrontDoor }
    | { bound: false; port: number; error: string };

const UPSTREAM_HOST = '127.0.0.1';

export function frontDoorConfig(env: NodeJS.ProcessEnv, apiPort: number): Omit<FrontDoorOptions, 'policy'> | null {
    const raw = env.FONTE_FRONT_DOOR_PORT?.trim() || '80';
    if (!/^\d+$/.test(raw)) return null;
    return {
        port: parseInt(raw, 10),
        host: '::',
        apiPort,
        dashboardPort: parseInt(env.FONTE_DASHBOARD_PORT || '3000', 10),
    };
}

export function isLoopbackPeer(address: string | undefined): boolean {
    if (!address) return false;
    const v4 = address.startsWith('::ffff:') ? address.slice(7) : address;
    return v4.startsWith('127.') || address === '::1';
}

function isApiPath(url: string): boolean {
    return url === '/api' || url.startsWith('/api/') || url.startsWith('/api?');
}

function proxy(req: http.IncomingMessage, res: http.ServerResponse, port: number, unavailable: string): void {
    const upstream = http.request({
        host: UPSTREAM_HOST,
        port,
        method: req.method,
        path: req.url,
        headers: req.headers,
    }, (upRes) => {
        res.writeHead(upRes.statusCode ?? 502, upRes.headers);
        res.flushHeaders();
        upRes.pipe(res);
    });
    upstream.on('error', () => {
        if (res.headersSent) {
            res.destroy();
            return;
        }
        res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(unavailable);
    });
    res.on('close', () => upstream.destroy());
    req.pipe(upstream);
}

export function startFrontDoor(options: FrontDoorOptions): Promise<FrontDoorResult> {
    const server = http.createServer((req, res) => {
        const host = req.headers.host;
        if (!host || !isAllowedHost(host, options.policy)) {
            res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
            res.end('Host not allowed');
            return;
        }
        const url = req.url ?? '/';
        if (isApiPath(url)) proxy(req, res, options.apiPort, 'The Fonte daemon is not running.');
        else proxy(req, res, options.dashboardPort, 'The Fonte dashboard is not running.');
    });
    server.on('connection', (socket: net.Socket) => {
        if (!isLoopbackPeer(socket.remoteAddress)) socket.destroy();
    });

    return new Promise((resolve) => {
        server.once('error', (err: NodeJS.ErrnoException) => {
            resolve({ bound: false, port: options.port, error: err.code ?? err.message });
        });
        server.listen(options.port, options.host, () => {
            const port = (server.address() as net.AddressInfo).port;
            resolve({
                bound: true,
                port,
                door: {
                    port,
                    close: () => new Promise((done) => {
                        server.closeAllConnections();
                        server.close(() => done());
                    }),
                },
            });
        });
    });
}
