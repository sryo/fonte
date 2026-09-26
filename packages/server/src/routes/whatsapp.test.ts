import { describe, it, expect, beforeEach, vi } from 'vitest';

const service = vi.hoisted(() => ({
    status: 'disconnected',
    linked: false,
    qr: null as string | null,
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    requestPairingCode: vi.fn(async () => 'ABCD1234'),
    getChats: vi.fn(async () => []),
    getStatusInfo: vi.fn((): Record<string, unknown> => ({ status: 'disconnected', linked: false })),
}));

const settings = vi.hoisted(() => ({ current: {} as Record<string, any> }));

vi.mock('@fonte/torrent', () => ({ getWhatsAppService: () => service }));
vi.mock('@fonte/core', () => ({
    log: vi.fn(),
    getSettings: () => settings.current,
    updateSettingsFile: vi.fn(async (fn: (s: Record<string, any>) => Record<string, any>) => {
        settings.current = fn(settings.current);
        return settings.current;
    }),
}));

import app from './whatsapp';

const post = (path: string, body?: unknown) => app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
});

beforeEach(() => {
    vi.clearAllMocks();
    service.status = 'disconnected';
    service.linked = false;
    settings.current = {};
});

describe('GET /api/whatsapp/status', () => {
    it('exposes whether a session is linked and why it last disconnected', async () => {
        service.getStatusInfo.mockReturnValueOnce({ status: 'disconnected', linked: false, reason: 'logged_out' });
        const res = await app.request('/api/whatsapp/status');
        expect(await res.json()).toEqual({ ok: true, status: 'disconnected', linked: false, reason: 'logged_out' });
    });
});

describe('POST /api/whatsapp/start', () => {
    it('answers with the full status so the UI can move on without waiting for a poll', async () => {
        service.getStatusInfo.mockReturnValueOnce({ status: 'connecting', linked: true });
        const res = await post('/api/whatsapp/start');
        expect(await res.json()).toEqual({ ok: true, status: 'connecting', linked: true });
    });
});

describe('POST /api/whatsapp/pair', () => {
    it('asks the service for a code without starting it separately', async () => {
        service.status = 'connecting';
        const res = await post('/api/whatsapp/pair', { phone: '+1 415 555 1234' });
        expect(await res.json()).toEqual({ ok: true, code: 'ABCD1234' });
        expect(service.start).not.toHaveBeenCalled();
        expect(service.requestPairingCode).toHaveBeenCalledWith('+1 415 555 1234');
    });

    it('rejects a phone number without digits as a bad request', async () => {
        const res = await post('/api/whatsapp/pair', { phone: '+ ( )' });
        expect(res.status).toBe(400);
        expect(service.requestPairingCode).not.toHaveBeenCalled();
    });

    it('answers 409 when a device is already linked', async () => {
        service.linked = true;
        const res = await post('/api/whatsapp/pair', { phone: '14155551234' });
        expect(res.status).toBe(409);
        expect(service.requestPairingCode).not.toHaveBeenCalled();
    });
});

describe('POST /api/whatsapp/allowed-chat', () => {
    it('keeps other whatsapp settings when saving the chat', async () => {
        settings.current = { whatsapp: { allowed_participants: ['a@s.whatsapp.net'] } };
        const res = await post('/api/whatsapp/allowed-chat', { allowed_chat: '1@g.us' });
        expect(await res.json()).toEqual({ ok: true, allowed_chat: '1@g.us' });
        expect(settings.current.whatsapp).toEqual({ allowed_participants: ['a@s.whatsapp.net'], allowed_chat: '1@g.us' });
    });

    it('rejects a non-string chat id', async () => {
        const res = await post('/api/whatsapp/allowed-chat', { allowed_chat: 42 });
        expect(res.status).toBe(400);
        expect(settings.current.whatsapp).toBeUndefined();
    });
});
