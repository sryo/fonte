import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
    settings: {} as Record<string, any>,
    sendMacNotification: vi.fn(),
    sendWhatsAppNotification: vi.fn(() => true),
}));

vi.mock('@fonte/core', () => ({
    getSettings: () => h.settings,
    sendMacNotification: h.sendMacNotification,
    sendWhatsAppNotification: h.sendWhatsAppNotification,
    isNotificationDestination: (v: unknown) => v === 'mac' || v === 'whatsapp' || v === 'both',
}));

import app from './notifications';

const realPlatform = process.platform;
const setPlatform = (p: string) => Object.defineProperty(process, 'platform', { value: p, configurable: true });

const post = (body?: unknown) => app.request('/api/notifications/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
});

beforeEach(() => {
    vi.clearAllMocks();
    setPlatform('darwin');
    h.settings = { whatsapp: { allowed_chat: '1234567890@c.us' } };
});

afterEach(() => setPlatform(realPlatform));

describe('POST /api/notifications/test', () => {
    it('sends to the Mac when no destination is given', async () => {
        const res = await post();
        expect(await res.json()).toEqual({ ok: true });
        expect(h.sendMacNotification).toHaveBeenCalledWith('Fonte', 'Notifications are working');
        expect(h.sendWhatsAppNotification).not.toHaveBeenCalled();
    });

    it('sends to WhatsApp only', async () => {
        const res = await post({ destination: 'whatsapp' });
        expect(await res.json()).toEqual({ ok: true });
        expect(h.sendWhatsAppNotification).toHaveBeenCalledWith('Fonte', 'Notifications are working');
        expect(h.sendMacNotification).not.toHaveBeenCalled();
    });

    it('sends to both', async () => {
        await post({ destination: 'both' });
        expect(h.sendWhatsAppNotification).toHaveBeenCalledTimes(1);
        expect(h.sendMacNotification).toHaveBeenCalledTimes(1);
    });

    it('asks for a chat when WhatsApp has none, sending nothing', async () => {
        h.settings = {};
        const res = await post({ destination: 'both' });
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ ok: false, error: 'Pick a WhatsApp chat first.' });
        expect(h.sendMacNotification).not.toHaveBeenCalled();
        expect(h.sendWhatsAppNotification).not.toHaveBeenCalled();
    });

    it('sends to WhatsApp off macOS', async () => {
        setPlatform('linux');
        const res = await post({ destination: 'whatsapp' });
        expect(await res.json()).toEqual({ ok: true });
    });

    it('refuses the Mac off macOS', async () => {
        setPlatform('linux');
        const res = await post({ destination: 'both' });
        expect(res.status).toBe(400);
        expect(h.sendWhatsAppNotification).not.toHaveBeenCalled();
    });

    it('rejects an unknown destination', async () => {
        const res = await post({ destination: 'pager' });
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/mac, whatsapp, or both/);
    });
});
