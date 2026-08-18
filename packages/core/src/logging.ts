import fs from 'fs';
import { LOG_FILE } from './config';

const MAX_LOG_BYTES = 5 * 1024 * 1024;

// Size is tracked in-process — stat once on the first write, then count bytes —
// so rotation costs no syscall per line. One rotated generation is kept:
// queue.log.1 is overwritten each time. CLI processes log too, so their own
// first-write stat picks up whatever the daemon has already written.
let currentSize: number | null = null;

function rotateIfNeeded(bytes: number): void {
    if (currentSize === null) {
        try {
            currentSize = fs.statSync(LOG_FILE).size;
        } catch {
            currentSize = 0;
        }
    }
    if (currentSize + bytes >= MAX_LOG_BYTES) {
        try {
            fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
        } catch {}
        currentSize = 0;
    }
    currentSize += bytes;
}

export function log(level: string, message: string): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}\n`;
    console.log(logMessage.trim());
    rotateIfNeeded(Buffer.byteLength(logMessage));
    fs.appendFileSync(LOG_FILE, logMessage);
}

/**
 * Pluggable event listeners.  The API server registers a listener so that
 * every event emitted by the queue processor is also broadcast over SSE.
 * The plugin system also registers a listener for plugin event handlers.
 */
type EventListener = (type: string, data: Record<string, unknown>) => void;
const eventListeners: EventListener[] = [];

/** Register a listener that is called on every emitEvent. */
export function onEvent(listener: EventListener): void {
    eventListeners.push(listener);
}

/**
 * Emit a structured event — dispatched to in-memory listeners (e.g. SSE broadcast, plugins).
 */
export function emitEvent(type: string, data: Record<string, unknown>): void {
    for (const listener of eventListeners) {
        try { listener(type, data); } catch { /* never break the queue processor */ }
    }
}
