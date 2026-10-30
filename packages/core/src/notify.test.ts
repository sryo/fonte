import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
    settings: {} as Record<string, any>,
    execFile: vi.fn(),
    enqueueResponse: vi.fn(() => 1),
    log: vi.fn(),
}));

vi.mock('child_process', () => ({ execFile: h.execFile }));
vi.mock('./config', () => ({ getSettings: () => h.settings }));
vi.mock('./queues', () => ({ enqueueResponse: h.enqueueResponse }));
vi.mock('./logging', () => ({ log: h.log }));

let notify: typeof import('./notify');
const realPlatform = process.platform;
const setPlatform = (p: string) => Object.defineProperty(process, 'platform', { value: p, configurable: true });

const CHAT = '1234567890@c.us';

const macTitles = () => h.execFile.mock.calls.map(c => (c as unknown[])[1] as string[]).map(argv => argv[2]);
const whatsAppMessages = () => h.enqueueResponse.mock.calls.map(c => (c as unknown as [{ message: string }])[0].message);
const warnings = () => h.log.mock.calls.filter(c => c[0] === 'WARN').map(c => c[1]);

beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    setPlatform('darwin');
    h.settings = {
        notifications: { enabled: true, torrent_completed: true, watchlist_match: true, automation_failed: true },
        whatsapp: { allowed_chat: CHAT },
    };
    notify = await import('./notify');
});

afterEach(() => setPlatform(realPlatform));

describe('notifyForEvent destinations', () => {
    it('keeps sending to the Mac when no destination is set', () => {
        notify.notifyForEvent('torrent:completed', { name: 'Ubuntu ISO' });
        expect(macTitles()).toEqual(['Download complete']);
        expect(h.enqueueResponse).not.toHaveBeenCalled();
    });

    it('sends to WhatsApp only, title and body on separate lines', () => {
        h.settings.notifications.destinations = { torrent_completed: 'whatsapp' };
        notify.notifyForEvent('torrent:completed', { name: 'Ubuntu ISO' });
        expect(h.execFile).not.toHaveBeenCalled();
        expect(h.enqueueResponse).toHaveBeenCalledWith(expect.objectContaining({
            channel: 'whatsapp',
            sender: 'Fonte',
            senderId: CHAT,
            message: 'Download complete\nUbuntu ISO',
            originalMessage: '',
            messageId: expect.stringMatching(/^notify_/),
        }));
    });

    it('sends to both', () => {
        h.settings.notifications.destinations = { automation_failed: 'both' };
        notify.notifyForEvent('automation:failed', { ruleName: 'Nightly', detail: 'boom', notify: true });
        expect(macTitles()).toEqual(['Automation "Nightly" failed']);
        expect(whatsAppMessages()).toEqual(['Automation "Nightly" failed\nboom']);
    });

    it('routes each event by its own destination', () => {
        h.settings.notifications.destinations = { watchlist_match: 'whatsapp' };
        notify.notifyForEvent('watchlist:results', { count: 2, title: 'Severance' });
        notify.notifyForEvent('watchlist:check_failed', { title: 'Severance', error: 'timeout', notify: true });
        notify.notifyForEvent('torrent:completed', { name: 'x' });
        expect(whatsAppMessages()).toEqual([
            'Watchlist results\n2 new results · Severance',
            'Watchlist check failed\nSeverance: timeout',
        ]);
        expect(macTitles()).toEqual(['Download complete']);
    });

    it('treats an unknown destination as the Mac', () => {
        h.settings.notifications.destinations = { torrent_completed: 'pager' };
        notify.notifyForEvent('torrent:completed', { name: 'x' });
        expect(macTitles()).toEqual(['Download complete']);
        expect(h.enqueueResponse).not.toHaveBeenCalled();
    });

    it('still respects the on/off toggles', () => {
        h.settings.notifications.torrent_completed = false;
        h.settings.notifications.destinations = { torrent_completed: 'whatsapp' };
        notify.notifyForEvent('torrent:completed', { name: 'x' });
        h.settings.notifications = { enabled: false, torrent_completed: true, destinations: { torrent_completed: 'both' } };
        notify.notifyForEvent('torrent:completed', { name: 'x' });
        expect(h.execFile).not.toHaveBeenCalled();
        expect(h.enqueueResponse).not.toHaveBeenCalled();
    });

    it('falls back to the Mac and warns once when no WhatsApp chat is picked', () => {
        h.settings.whatsapp = {};
        h.settings.notifications.destinations = { torrent_completed: 'whatsapp' };
        notify.notifyForEvent('torrent:completed', { name: 'a' });
        notify.notifyForEvent('torrent:completed', { name: 'b' });
        expect(h.enqueueResponse).not.toHaveBeenCalled();
        expect(macTitles()).toEqual(['Download complete', 'Download complete']);
        expect(warnings()).toHaveLength(1);
        expect(warnings()[0]).toMatch(/WhatsApp/);
    });

    it('sends "both" to the Mac once when no WhatsApp chat is picked', () => {
        h.settings.whatsapp = { allowed_chat: null };
        h.settings.notifications.destinations = { torrent_completed: 'both' };
        notify.notifyForEvent('torrent:completed', { name: 'a' });
        expect(macTitles()).toEqual(['Download complete']);
    });

    it('delivers to WhatsApp off macOS without touching osascript', () => {
        setPlatform('linux');
        h.settings.notifications.destinations = { torrent_completed: 'both' };
        notify.notifyForEvent('torrent:completed', { name: 'a' });
        expect(h.execFile).not.toHaveBeenCalled();
        expect(whatsAppMessages()).toEqual(['Download complete\na']);
    });

    it('logs instead of throwing when the queue rejects the message', () => {
        h.enqueueResponse.mockImplementationOnce(() => { throw new Error('Queue DB not initialized'); });
        h.settings.notifications.destinations = { torrent_completed: 'whatsapp' };
        expect(() => notify.notifyForEvent('torrent:completed', { name: 'a' })).not.toThrow();
        expect(h.log).toHaveBeenCalledWith('ERROR', expect.stringContaining('Queue DB not initialized'));
    });
});

describe('sendWhatsAppNotification', () => {
    it('reports false without a picked chat', () => {
        h.settings.whatsapp = {};
        expect(notify.sendWhatsAppNotification('Fonte', 'hi')).toBe(false);
        expect(h.enqueueResponse).not.toHaveBeenCalled();
    });

    it('reports true once enqueued', () => {
        expect(notify.sendWhatsAppNotification('Fonte', 'hi')).toBe(true);
        expect(whatsAppMessages()).toEqual(['Fonte\nhi']);
    });
});

describe('isNotificationDestination', () => {
    it('accepts the three destinations only', () => {
        expect(['mac', 'whatsapp', 'both', 'sms', undefined, 1].map(notify.isNotificationDestination))
            .toEqual([true, true, true, false, false, false]);
    });
});
