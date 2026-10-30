import { randomBytes } from 'crypto';
import http from 'http';
import { onEvent } from '@fonte/core';

export const SSE_BUFFER_SIZE = 200;
export const SSE_HEARTBEAT_MS = 25_000;
export const SSE_MAX_BUFFERED_BYTES = 1024 * 1024;

const HEARTBEAT = ': ping\n\n';

interface Buffered {
    seq: number;
    message: string;
}

const sseClients = new Set<http.ServerResponse>();
let epoch = newEpoch();
let seq = 0;
let buffer: Buffered[] = [];
let heartbeat: NodeJS.Timeout | null = null;

// Ids are `<epoch>-<seq>`. The epoch changes every process start, so an id from
// an earlier daemon run is rejected even when its seq is within today's range.
function newEpoch(): string {
    return Date.now().toString(36) + randomBytes(3).toString('hex');
}

function currentId(): string {
    return `${epoch}-${seq}`;
}

/** Broadcast an SSE event to every connected client. */
export function broadcastSSE(event: string, data: unknown): void {
    seq += 1;
    const message = `id: ${currentId()}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    buffer.push({ seq, message });
    if (buffer.length > SSE_BUFFER_SIZE) buffer.shift();
    for (const client of sseClients) send(client, message);
}

export function addSSEClient(res: http.ServerResponse): void {
    if (res.destroyed || res.writableEnded) return;
    sseClients.add(res);
    res.once('close', () => removeSSEClient(res));
    startHeartbeat();

    const backlog = missedSince(res.req?.headers['last-event-id']);
    if (backlog === 'resync' || exceedsCap(res, backlog)) {
        send(res, `id: ${currentId()}\nevent: resync\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`);
    } else {
        for (const entry of backlog) {
            if (!sseClients.has(res)) break;
            send(res, entry.message);
        }
    }
}

export function removeSSEClient(res: http.ServerResponse): void {
    sseClients.delete(res);
    if (sseClients.size === 0) stopHeartbeat();
}

export function getSSEClientCount(): number {
    return sseClients.size;
}

export function resetSSEState(): void {
    sseClients.clear();
    stopHeartbeat();
    epoch = newEpoch();
    seq = 0;
    buffer = [];
}

function missedSince(header: string | string[] | undefined): Buffered[] | 'resync' {
    const raw = Array.isArray(header) ? header[0] : header;
    const lastId = raw?.trim();
    if (!lastId) return [];

    const match = /^([a-z0-9]+)-(\d+)$/.exec(lastId);
    if (!match || match[1] !== epoch) return 'resync';
    const lastSeq = Number(match[2]);
    if (lastSeq > seq) return 'resync';
    if (lastSeq === seq) return [];

    const oldest = buffer[0]?.seq ?? seq + 1;
    if (lastSeq < oldest - 1) return 'resync';
    return buffer.filter((entry) => entry.seq > lastSeq);
}

// A backlog that would itself trip the cap would drop the client on every
// reconnect, so it gets a resync instead.
function exceedsCap(res: http.ServerResponse, backlog: Buffered[]): boolean {
    let bytes = res.writableLength;
    for (const entry of backlog) bytes += Buffer.byteLength(entry.message);
    return bytes > SSE_MAX_BUFFERED_BYTES;
}

function send(res: http.ServerResponse, chunk: string): void {
    if (res.destroyed || res.writableEnded) {
        removeSSEClient(res);
        return;
    }
    try {
        res.write(chunk);
    } catch {
        drop(res);
        return;
    }
    if (res.writableLength > SSE_MAX_BUFFERED_BYTES) drop(res);
}

function drop(res: http.ServerResponse): void {
    removeSSEClient(res);
    try { res.destroy(); } catch { /* already torn down */ }
}

function startHeartbeat(): void {
    if (heartbeat) return;
    heartbeat = setInterval(() => {
        for (const client of sseClients) send(client, HEARTBEAT);
    }, SSE_HEARTBEAT_MS);
    heartbeat.unref();
}

function stopHeartbeat(): void {
    if (!heartbeat) return;
    clearInterval(heartbeat);
    heartbeat = null;
}

// Wire emitEvent → SSE so every queue-processor event is also pushed to the web.
onEvent((type, data) => {
    broadcastSSE(type, { type, timestamp: Date.now(), ...data });
});
