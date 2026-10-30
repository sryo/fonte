import { EventEmitter } from 'events';
import fs from 'fs';
import http from 'http';
import type { AddressInfo } from 'net';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';

// @fonte/core resolves FONTE_HOME once at import time, so the temp home must be
// set before the first dynamic import.
let tmpHome: string;
let sse: typeof import('./sse');
let core: typeof import('@fonte/core');

beforeAll(async () => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fonte-sse-test-'));
    process.env.FONTE_HOME = tmpHome;
    sse = await import('./sse');
    core = await import('@fonte/core');
});

afterAll(() => {
    delete process.env.FONTE_HOME;
    fs.rmSync(tmpHome, { recursive: true, force: true });
});

beforeEach(() => {
    sse.resetSSEState();
});

afterEach(() => {
    vi.useRealTimers();
    sse.resetSSEState();
});

interface Frame {
    event?: string;
    id?: string;
    data?: string;
    comment?: string;
}

function parseFrames(raw: string): Frame[] {
    return raw.split('\n\n').filter(Boolean).map((block) => {
        const frame: Frame = {};
        for (const line of block.split('\n')) {
            if (line.startsWith(':')) frame.comment = line.slice(1).trim();
            else if (line.startsWith('event: ')) frame.event = line.slice(7);
            else if (line.startsWith('id: ')) frame.id = line.slice(4);
            else if (line.startsWith('data: ')) frame.data = line.slice(6);
        }
        return frame;
    });
}

class FakeRes extends EventEmitter {
    chunks: string[] = [];
    writableLength = 0;
    destroyed = false;
    writableEnded = false;
    throwOnWrite = false;
    writeReturns = true;
    req: { headers: Record<string, string> };

    constructor(lastEventId?: string) {
        super();
        this.req = { headers: lastEventId === undefined ? {} : { 'last-event-id': lastEventId } };
    }

    write(chunk: string): boolean {
        if (this.throwOnWrite) throw new Error('EPIPE');
        this.chunks.push(chunk);
        return this.writeReturns;
    }

    end(): this {
        this.writableEnded = true;
        return this;
    }

    destroy(): this {
        if (!this.destroyed) {
            this.destroyed = true;
            this.emit('close');
        }
        return this;
    }

    frames(): Frame[] {
        return parseFrames(this.chunks.join(''));
    }

    events(): Frame[] {
        return this.frames().filter((f) => f.event);
    }
}

function add(res: FakeRes): FakeRes {
    sse.addSSEClient(res as unknown as http.ServerResponse);
    return res;
}

function lastOf<T>(items: T[]): T {
    return items[items.length - 1];
}

function seqOf(id: string | undefined): number {
    return Number(id!.split('-')[1]);
}

function epochOf(id: string | undefined): string {
    return id!.split('-')[0];
}

describe('event ids', () => {
    it('stamps every broadcast with an increasing <epoch>-<n> id', () => {
        const res = add(new FakeRes());
        sse.broadcastSSE('a', { n: 1 });
        sse.broadcastSSE('b', { n: 2 });
        sse.broadcastSSE('c', { n: 3 });

        const events = res.events();
        expect(events.map((e) => e.event)).toEqual(['a', 'b', 'c']);
        for (const e of events) expect(e.id).toMatch(/^[a-z0-9]+-\d+$/);
        const seqs = events.map((e) => seqOf(e.id));
        expect(seqs[1]).toBe(seqs[0] + 1);
        expect(seqs[2]).toBe(seqs[1] + 1);
        expect(new Set(events.map((e) => epochOf(e.id))).size).toBe(1);
        expect(JSON.parse(events[0].data!)).toEqual({ n: 1 });
    });

    it('stamps events routed through emitEvent', () => {
        const res = add(new FakeRes());
        core.emitEvent('torrent:added', { name: 'x' });

        const [e] = res.events();
        expect(e.event).toBe('torrent:added');
        expect(e.id).toMatch(/^[a-z0-9]+-\d+$/);
        expect(JSON.parse(e.data!)).toMatchObject({ type: 'torrent:added', name: 'x' });
    });
});

describe('replay on reconnect', () => {
    it('replays only the events after Last-Event-ID, in order', () => {
        const first = add(new FakeRes());
        for (let i = 1; i <= 5; i++) sse.broadcastSSE('tick', { i });
        const ids = first.events().map((e) => e.id!);

        const second = add(new FakeRes(ids[1]));
        const replayed = second.events();
        expect(replayed.map((e) => e.id)).toEqual(ids.slice(2));
        expect(replayed.map((e) => JSON.parse(e.data!).i)).toEqual([3, 4, 5]);
    });

    it('writes nothing extra when the client is already up to date', () => {
        const first = add(new FakeRes());
        sse.broadcastSSE('tick', {});
        const last = lastOf(first.events()).id!;

        const second = add(new FakeRes(last));
        expect(second.chunks).toEqual([]);
    });

    it('treats an empty Last-Event-ID as a fresh connection', () => {
        sse.broadcastSSE('tick', {});
        const res = add(new FakeRes(''));
        expect(res.chunks).toEqual([]);
    });

    it('sends resync when the missed events have fallen out of the buffer', () => {
        const first = add(new FakeRes());
        sse.broadcastSSE('tick', { i: 0 });
        const oldId = first.events()[0].id!;
        for (let i = 1; i <= sse.SSE_BUFFER_SIZE + 5; i++) sse.broadcastSSE('tick', { i });
        const latest = lastOf(first.events()).id!;

        const second = add(new FakeRes(oldId));
        const frames = second.events();
        expect(frames).toHaveLength(1);
        expect(frames[0].event).toBe('resync');
        expect(frames[0].id).toBe(latest);
        expect(JSON.parse(frames[0].data!)).toMatchObject({ timestamp: expect.any(Number) });
    });

    it('replays when the gap exactly fits the buffer', () => {
        const first = add(new FakeRes());
        sse.broadcastSSE('tick', { i: 0 });
        const lastSeen = first.events()[0].id!;
        for (let i = 1; i <= sse.SSE_BUFFER_SIZE; i++) sse.broadcastSSE('tick', { i });

        const second = add(new FakeRes(lastSeen));
        const frames = second.events();
        expect(frames).toHaveLength(sse.SSE_BUFFER_SIZE);
        expect(frames.every((f) => f.event === 'tick')).toBe(true);
    });

    it('sends resync instead of a backlog larger than the cap', () => {
        const first = add(new FakeRes());
        sse.broadcastSSE('tick', { i: 0 });
        const lastSeen = first.events()[0].id!;
        const payload = 'x'.repeat(Math.ceil(sse.SSE_MAX_BUFFERED_BYTES / 4));
        for (let i = 1; i <= 5; i++) sse.broadcastSSE('tick', { i, payload });

        const second = add(new FakeRes(lastSeen));
        expect(second.events().map((f) => f.event)).toEqual(['resync']);
        expect(second.destroyed).toBe(false);
    });

    it('sends resync for an id from another daemon run even when the number overlaps', () => {
        const first = add(new FakeRes());
        for (let i = 1; i <= 5; i++) sse.broadcastSSE('tick', { i });
        const [, n] = first.events()[1].id!.split('-');

        const second = add(new FakeRes(`zzzzforeign-${n}`));
        const frames = second.events();
        expect(frames.map((f) => f.event)).toEqual(['resync']);
    });

    it('sends resync for an id ahead of the current sequence', () => {
        const first = add(new FakeRes());
        sse.broadcastSSE('tick', {});
        const id = first.events()[0].id!;

        const second = add(new FakeRes(`${epochOf(id)}-${seqOf(id) + 50}`));
        expect(second.events().map((f) => f.event)).toEqual(['resync']);
    });

    it('sends resync for an unparseable Last-Event-ID', () => {
        sse.broadcastSSE('tick', {});
        const res = add(new FakeRes('not-an-id'));
        expect(res.events().map((f) => f.event)).toEqual(['resync']);
    });

    it('lets a resynced client replay normally on its next reconnect', () => {
        const first = add(new FakeRes());
        sse.broadcastSSE('tick', { i: 1 });
        const resynced = add(new FakeRes('garbage'));
        const resyncId = resynced.events()[0].id!;
        sse.broadcastSSE('tick', { i: 2 });

        const again = add(new FakeRes(resyncId));
        expect(again.events().map((e) => JSON.parse(e.data!).i)).toEqual([2]);
        expect(first.events()).toHaveLength(2);
    });
});

describe('heartbeat', () => {
    it('pings every client every 25s on one shared interval', () => {
        vi.useFakeTimers();
        const a = add(new FakeRes());
        const b = add(new FakeRes());
        expect(vi.getTimerCount()).toBe(1);

        vi.advanceTimersByTime(sse.SSE_HEARTBEAT_MS - 1);
        expect(a.chunks).toEqual([]);
        vi.advanceTimersByTime(1);
        expect(a.chunks).toEqual([': ping\n\n']);
        expect(b.chunks).toEqual([': ping\n\n']);
        vi.advanceTimersByTime(sse.SSE_HEARTBEAT_MS);
        expect(a.frames().filter((f) => f.comment === 'ping')).toHaveLength(2);
    });

    it('starts lazily and clears the interval when the last client leaves', () => {
        vi.useFakeTimers();
        expect(vi.getTimerCount()).toBe(0);
        const a = add(new FakeRes());
        const b = add(new FakeRes());
        expect(vi.getTimerCount()).toBe(1);

        sse.removeSSEClient(a as unknown as http.ServerResponse);
        expect(vi.getTimerCount()).toBe(1);
        b.destroy();
        expect(vi.getTimerCount()).toBe(0);

        add(new FakeRes());
        expect(vi.getTimerCount()).toBe(1);
    });

    it('clears the interval when the last client is dropped for backpressure', () => {
        vi.useFakeTimers();
        const a = add(new FakeRes());
        a.writableLength = sse.SSE_MAX_BUFFERED_BYTES + 1;
        sse.broadcastSSE('tick', {});
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('backpressure and failures', () => {
    it('drops a client whose buffered bytes exceed the cap while others keep receiving', () => {
        const slow = add(new FakeRes());
        const fast = add(new FakeRes());
        sse.broadcastSSE('tick', { i: 1 });

        slow.writableLength = sse.SSE_MAX_BUFFERED_BYTES + 1;
        sse.broadcastSSE('tick', { i: 2 });
        sse.broadcastSSE('tick', { i: 3 });

        expect(slow.destroyed).toBe(true);
        expect(slow.events().length).toBeLessThanOrEqual(2);
        expect(fast.events().map((e) => JSON.parse(e.data!).i)).toEqual([1, 2, 3]);
        expect(sse.getSSEClientCount()).toBe(1);
    });

    it('keeps a client whose write returns false while under the cap', () => {
        const res = add(new FakeRes());
        res.writeReturns = false;
        res.writableLength = 1024;
        sse.broadcastSSE('tick', { i: 1 });
        sse.broadcastSSE('tick', { i: 2 });

        expect(res.destroyed).toBe(false);
        expect(res.events()).toHaveLength(2);
    });

    it('drops a client whose write throws', () => {
        const broken = add(new FakeRes());
        const ok = add(new FakeRes());
        broken.throwOnWrite = true;
        sse.broadcastSSE('tick', {});

        expect(broken.destroyed).toBe(true);
        expect(ok.events()).toHaveLength(1);
        expect(sse.getSSEClientCount()).toBe(1);
    });

    it('stops writing to a client once it closes', () => {
        const res = add(new FakeRes());
        sse.broadcastSSE('tick', { i: 1 });
        res.emit('close');
        sse.broadcastSSE('tick', { i: 2 });

        expect(res.events()).toHaveLength(1);
        expect(sse.getSSEClientCount()).toBe(0);
    });

    it('ignores a response that is already destroyed', () => {
        const res = new FakeRes();
        res.destroyed = true;
        add(res);
        expect(sse.getSSEClientCount()).toBe(0);
    });
});

describe('over real HTTP', () => {
    let server: http.Server;
    let port: number;
    let serverSide: http.ServerResponse[];

    beforeEach(async () => {
        serverSide = [];
        server = http.createServer((req, res) => {
            serverSide.push(res);
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            });
            res.write(`event: connected\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`);
            sse.addSSEClient(res);
            res.on('close', () => sse.removeSSEClient(res));
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        port = (server.address() as AddressInfo).port;
    });

    afterEach(async () => {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    interface Stream {
        req: http.ClientRequest;
        res: http.IncomingMessage;
        raw: () => string;
        events: () => Frame[];
        waitFor: (pred: (frames: Frame[]) => boolean) => Promise<void>;
        close: () => void;
    }

    async function open(headers: Record<string, string> = {}, opts: { paused?: boolean } = {}): Promise<Stream> {
        const before = sse.getSSEClientCount();
        const req = http.request({ host: '127.0.0.1', port, path: '/', headers, agent: false });
        const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
            req.on('response', resolve);
            req.on('error', reject);
            req.end();
        });
        res.setEncoding('utf8');
        let raw = '';
        const listeners = new Set<() => void>();
        if (!opts.paused) {
            res.on('data', (chunk: string) => {
                raw += chunk;
                for (const l of listeners) l();
            });
        }
        res.on('error', () => {});
        await until(() => sse.getSSEClientCount() > before);
        const events = () => parseFrames(raw).filter((f) => f.event);
        return {
            req,
            res,
            raw: () => raw,
            events,
            waitFor: (pred) => new Promise<void>((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error(`timed out; got ${JSON.stringify(events())}`)), 3000);
                const check = () => {
                    if (pred(events())) {
                        clearTimeout(timer);
                        listeners.delete(check);
                        resolve();
                    }
                };
                listeners.add(check);
                check();
            }),
            close: () => req.destroy(),
        };
    }

    async function until(pred: () => boolean, ms = 3000): Promise<void> {
        const start = Date.now();
        while (!pred()) {
            if (Date.now() - start > ms) throw new Error('condition not met in time');
            await new Promise((r) => setTimeout(r, 5));
        }
    }

    it('replays missed ids to a reconnecting client that sends Last-Event-ID', async () => {
        const live = await open();
        for (let i = 1; i <= 3; i++) sse.broadcastSSE('tick', { i });
        await live.waitFor((f) => f.filter((e) => e.event === 'tick').length === 3);
        const seen = live.events().filter((e) => e.event === 'tick').map((e) => e.id!);
        live.close();
        await until(() => sse.getSSEClientCount() === 0);

        for (let i = 4; i <= 6; i++) sse.broadcastSSE('tick', { i });

        const back = await open({ 'Last-Event-ID': lastOf(seen) });
        await back.waitFor((f) => f.filter((e) => e.event === 'tick').length === 3);
        const replayed = back.events();
        expect(replayed[0].event).toBe('connected');
        const ticks = replayed.filter((e) => e.event === 'tick');
        expect(ticks.map((e) => JSON.parse(e.data!).i)).toEqual([4, 5, 6]);
        expect(ticks.map((e) => seqOf(e.id))).toEqual([4, 5, 6].map((k) => seqOf(seen[0]) + k - 1));

        sse.broadcastSSE('tick', { i: 7 });
        await back.waitFor((f) => f.some((e) => e.event === 'tick' && JSON.parse(e.data!).i === 7));
        back.close();
    });

    it('sends resync to a client carrying an id from a previous daemon run', async () => {
        sse.broadcastSSE('tick', {});
        const back = await open({ 'Last-Event-ID': 'previousrun-1' });
        await back.waitFor((f) => f.some((e) => e.event === 'resync'));
        expect(back.events().map((e) => e.event)).toEqual(['connected', 'resync']);
        back.close();
    });

    it('drops a stalled client past the cap while a reading client receives everything', async () => {
        const fast = await open({}, { paused: true });
        let fastFrames = 0;
        let tail = '';
        fast.res.on('data', (chunk: string) => {
            const joined = tail + chunk;
            fastFrames += joined.split('\n\n').length - 1;
            tail = joined.endsWith('\n') ? '\n' : '';
        });
        await until(() => fastFrames >= 1);
        const slow = await open({}, { paused: true });
        expect(sse.getSSEClientCount()).toBe(2);

        const payload = 'x'.repeat(256 * 1024);
        let sent = 0;
        while (sse.getSSEClientCount() === 2 && sent < 200) {
            sse.broadcastSSE('bulk', { i: sent, payload });
            sent++;
            await until(() => fastFrames === 1 + sent);
        }

        expect(sse.getSSEClientCount()).toBe(1);
        expect(sent).toBeLessThan(200);
        expect(serverSide[1].destroyed).toBe(true);
        expect(serverSide[0].destroyed).toBe(false);
        sse.broadcastSSE('after', { ok: true });
        await until(() => fastFrames === 2 + sent);
        fast.close();
        slow.close();
    }, 20000);
});
