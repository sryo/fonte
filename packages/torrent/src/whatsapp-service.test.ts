import fs from 'fs';
import os from 'os';
import path from 'path';
import { EventEmitter } from 'events';
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';

const h = vi.hoisted(() => {
    const nodeFs = require('fs') as typeof import('fs');
    const nodeOs = require('os') as typeof import('os');
    const nodePath = require('path') as typeof import('path');
    const home = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'fonte-whatsapp-test-'));
    return {
        home,
        sockets: [] as FakeSocket[],
        creds: {} as Record<string, unknown>,
        authGate: null as Promise<void> | null,
    };
});

interface FakeSocket {
    ev: EventEmitter;
    user?: { id: string };
    requestPairingCode: ReturnType<typeof vi.fn>;
    logout: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
    groupFetchAllParticipating: ReturnType<typeof vi.fn>;
}

vi.mock('@whiskeysockets/baileys', () => ({
    makeWASocket: vi.fn(() => {
        const sock: FakeSocket = {
            ev: new EventEmitter(),
            requestPairingCode: vi.fn(async () => 'ABCD1234'),
            logout: vi.fn(async () => undefined),
            end: vi.fn(),
            groupFetchAllParticipating: vi.fn(async () => ({})),
        };
        h.sockets.push(sock);
        return sock;
    }),
    useMultiFileAuthState: vi.fn(async () => {
        if (h.authGate) await h.authGate;
        return { state: { creds: h.creds, keys: {} }, saveCreds: vi.fn(async () => undefined) };
    }),
    makeCacheableSignalKeyStore: vi.fn((keys: unknown) => keys),
    fetchLatestWaWebVersion: vi.fn(async () => ({ version: [2, 3000, 1] })),
    DisconnectReason: { loggedOut: 401, restartRequired: 515, timedOut: 408, connectionReplaced: 440 },
    Browsers: { macOS: (name: string) => ['Mac OS', name, '14'] },
    downloadMediaMessage: vi.fn(),
}));

vi.mock('@fonte/core', () => ({
    log: vi.fn(),
    emitEvent: vi.fn(),
    FONTE_HOME: h.home,
    FILES_DIR: require('path').join(h.home, 'files'),
    enqueueMessage: vi.fn(),
    getResponsesForChannel: vi.fn(() => []),
    ackResponse: vi.fn(),
    getSettings: vi.fn(() => ({})),
}));

import { WhatsAppService, hasLinkedSession } from './whatsapp-service';
import { makeWASocket } from '@whiskeysockets/baileys';

const AUTH_DIR = path.join(h.home, 'whatsapp-auth');

const closeWith = (sock: FakeSocket, statusCode: number) =>
    sock.ev.emit('connection.update', {
        connection: 'close',
        lastDisconnect: { error: { output: { statusCode } } },
    });
const open = (sock: FakeSocket) => sock.ev.emit('connection.update', { connection: 'open' });
const showQr = (sock: FakeSocket, qr = 'qr-ref') => sock.ev.emit('connection.update', { qr });

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(r => { resolve = r; });
    return { promise, resolve };
}

let service: WhatsAppService;

beforeEach(() => {
    h.sockets.length = 0;
    h.creds = {};
    h.authGate = null;
    vi.mocked(makeWASocket).mockClear();
    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    service = new WhatsAppService();
});

afterEach(async () => {
    await service.stop();
    vi.useRealTimers();
});

afterAll(() => {
    fs.rmSync(h.home, { recursive: true, force: true });
});

describe('start/stop races', () => {
    it('does not open a socket when stopped while start is still loading credentials', async () => {
        const gate = deferred();
        h.authGate = gate.promise;
        const starting = service.start();
        await service.stop();
        gate.resolve();
        await starting.catch(() => undefined);
        expect(makeWASocket).not.toHaveBeenCalled();
        expect(service.status).toBe('disconnected');
    });

    it('opens a single socket when start is called while a reconnect is mid-connect', async () => {
        vi.useFakeTimers();
        h.creds = { account: {} };
        await service.start();
        open(h.sockets[0]);
        closeWith(h.sockets[0], 408);

        const gate = deferred();
        h.authGate = gate.promise;
        await vi.advanceTimersByTimeAsync(5000);
        const manual = service.start();
        gate.resolve();
        await manual;
        await vi.advanceTimersByTimeAsync(0);

        expect(makeWASocket).toHaveBeenCalledTimes(2);
    });
});

describe('connection lifecycle', () => {
    it('reports connecting, not disconnected, while a reconnect is pending', async () => {
        vi.useFakeTimers();
        h.creds = { account: {} };
        await service.start();
        open(h.sockets[0]);
        closeWith(h.sockets[0], 408);
        expect(service.status).toBe('connecting');
    });

    it('restarts right away after pairing succeeds (515) without dropping to disconnected', async () => {
        vi.useFakeTimers();
        await service.start();
        showQr(h.sockets[0]);
        closeWith(h.sockets[0], 515);
        expect(service.status).toBe('connecting');
        await vi.advanceTimersByTimeAsync(0);
        expect(makeWASocket).toHaveBeenCalledTimes(2);
    });

    it('stops instead of looping new QR codes when an unlinked QR session expires', async () => {
        vi.useFakeTimers();
        await service.start();
        showQr(h.sockets[0]);
        closeWith(h.sockets[0], 408);
        await vi.advanceTimersByTimeAsync(10 * 60_000);
        expect(makeWASocket).toHaveBeenCalledTimes(1);
        expect(service.getStatusInfo()).toMatchObject({ status: 'disconnected', reason: 'qr_expired' });
    });

    it('explains a server-side logout and marks the session unlinked', async () => {
        h.creds = { account: {} };
        await service.start();
        open(h.sockets[0]);
        expect(service.getStatusInfo().linked).toBe(true);
        closeWith(h.sockets[0], 401);
        expect(service.getStatusInfo()).toMatchObject({ status: 'disconnected', reason: 'logged_out', linked: false });
    });

    it('does not fight a session that replaced this one', async () => {
        vi.useFakeTimers();
        h.creds = { account: {} };
        await service.start();
        open(h.sockets[0]);
        closeWith(h.sockets[0], 440);
        await vi.advanceTimersByTimeAsync(10 * 60_000);
        expect(makeWASocket).toHaveBeenCalledTimes(1);
        expect(service.getStatusInfo()).toMatchObject({ status: 'disconnected', reason: 'replaced' });
    });

    it('clears the disconnect reason on the next start', async () => {
        await service.start();
        showQr(h.sockets[0]);
        closeWith(h.sockets[0], 408);
        await service.start();
        expect(service.getStatusInfo().reason).toBeUndefined();
    });
});

describe('requestPairingCode', () => {
    it('starts the service and waits for the socket to be ready before asking for a code', async () => {
        const pending = service.requestPairingCode('+1 415 555 1234');
        await vi.waitFor(() => expect(h.sockets).toHaveLength(1));
        const sock = h.sockets[0];
        expect(sock.requestPairingCode).not.toHaveBeenCalled();
        showQr(sock);
        await expect(pending).resolves.toBe('ABCD1234');
        expect(sock.requestPairingCode).toHaveBeenCalledWith('14155551234');
    });

    it('fails with a clear message when the socket closes before it is ready', async () => {
        const pending = service.requestPairingCode('14155551234');
        await vi.waitFor(() => expect(h.sockets).toHaveLength(1));
        closeWith(h.sockets[0], 500);
        await expect(pending).rejects.toThrow(/closed before/i);
    });

    it('refuses when this device is already linked', async () => {
        h.creds = { account: {} };
        await service.start();
        open(h.sockets[0]);
        await expect(service.requestPairingCode('14155551234')).rejects.toThrow(/already linked/i);
    });
});

describe('unlink', () => {
    it('wipes saved credentials even when no socket is open', async () => {
        fs.mkdirSync(AUTH_DIR, { recursive: true });
        fs.writeFileSync(path.join(AUTH_DIR, 'creds.json'), '{"account":{}}');
        await service.stop({ logout: true });
        expect(fs.existsSync(AUTH_DIR)).toBe(false);
    });
});

describe('hasLinkedSession', () => {
    it('is false without credentials', () => {
        expect(hasLinkedSession()).toBe(false);
    });

    it('is false for credentials left by an unfinished pairing', () => {
        fs.mkdirSync(AUTH_DIR, { recursive: true });
        fs.writeFileSync(path.join(AUTH_DIR, 'creds.json'), JSON.stringify({ me: { id: '1@s.whatsapp.net' } }));
        expect(hasLinkedSession()).toBe(false);
    });

    it('is true once pairing stored the account', () => {
        fs.mkdirSync(AUTH_DIR, { recursive: true });
        fs.writeFileSync(path.join(AUTH_DIR, 'creds.json'), JSON.stringify({ me: { id: '1@s.whatsapp.net' }, account: { details: 'x' } }));
        expect(hasLinkedSession()).toBe(true);
    });
});
