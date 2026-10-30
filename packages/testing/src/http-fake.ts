import http, { type IncomingHttpHeaders, type ServerResponse } from 'http';
import type { AddressInfo } from 'net';

export interface RecordedRequest {
    method: string;
    path: string;
    query: URLSearchParams;
    headers: IncomingHttpHeaders;
    body: string;
}

export interface RunningServer {
    url: string;
    host: string;
    port: number;
    requests: RecordedRequest[];
    close(): Promise<void>;
}

export type FakeHandler = (req: RecordedRequest, res: ServerResponse) => void | Promise<void>;

export function send(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void {
    res.writeHead(status, { 'Content-Length': Buffer.byteLength(body), ...headers });
    res.end(body);
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
    send(res, status, JSON.stringify(body), { 'Content-Type': 'application/json', ...headers });
}

/** A node:http server on 127.0.0.1 and an OS-picked port that records every request it serves. */
export async function startHttpFake(handler: FakeHandler): Promise<RunningServer> {
    const requests: RecordedRequest[] = [];
    const server = http.createServer(async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const parsed = new URL(req.url ?? '/', 'http://127.0.0.1');
        const recorded: RecordedRequest = {
            method: req.method ?? 'GET',
            path: parsed.pathname,
            query: parsed.searchParams,
            headers: req.headers,
            body: Buffer.concat(chunks).toString('utf8'),
        };
        requests.push(recorded);
        try {
            await handler(recorded, res);
        } catch (err) {
            if (!res.headersSent) send(res, 500, `fake handler threw: ${(err as Error).message}`);
            else res.end();
        }
    });

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve());
    });
    const { port } = server.address() as AddressInfo;

    let closing: Promise<void> | null = null;
    return {
        url: `http://127.0.0.1:${port}`,
        host: '127.0.0.1',
        port,
        requests,
        close() {
            closing ??= new Promise<void>(resolve => {
                server.closeAllConnections();
                server.close(() => resolve());
            });
            return closing;
        },
    };
}
