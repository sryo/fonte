import { execFile } from 'child_process';
import { getSettings } from './config';
import { log } from './logging';
import { enqueueResponse } from './queues';
import { genId } from './ids';
import type { NotificationDestination } from './types';

// `on run argv` passes title/body as argv items — torrent names never get
// interpolated into the script, so quotes and backslashes need no escaping.
const OSA_SCRIPT =
    'on run argv\n  display notification (item 2 of argv) with title (item 1 of argv)\nend run';

const DESTINATIONS: readonly NotificationDestination[] = ['mac', 'whatsapp', 'both'];

export function isNotificationDestination(value: unknown): value is NotificationDestination {
    return DESTINATIONS.includes(value as NotificationDestination);
}

/** Fire a native macOS notification via osascript. Fire-and-forget; failures only log. */
export function sendMacNotification(title: string, body: string): void {
    if (process.platform !== 'darwin') {
        log('WARN', 'Notifications: native notifications require macOS');
        return;
    }
    execFile('osascript', ['-e', OSA_SCRIPT, title, body], (err) => {
        if (err) log('ERROR', `Notification failed: ${err.message}`);
    });
}

/**
 * Queue a plain-text message to the allowed WhatsApp chat; the WhatsApp
 * service's response poller delivers it. False when no chat is picked.
 */
export function sendWhatsAppNotification(title: string, body: string): boolean {
    const chat = getSettings().whatsapp?.allowed_chat;
    if (!chat) return false;
    try {
        enqueueResponse({
            channel: 'whatsapp',
            sender: 'Fonte',
            senderId: chat,
            message: `${title}\n${body}`,
            originalMessage: '',
            messageId: genId('notify'),
        });
    } catch (err) {
        log('ERROR', `WhatsApp notification failed: ${(err as Error).message}`);
    }
    return true;
}

let warnedNoChat = false;

function deliver(title: string, body: string, destination: unknown): void {
    const dest = isNotificationDestination(destination) ? destination : 'mac';
    let toMac = dest !== 'whatsapp';
    if (dest !== 'mac') {
        if (sendWhatsAppNotification(title, body)) {
            warnedNoChat = false;
        } else {
            if (!warnedNoChat) {
                log('WARN', 'Notifications: no WhatsApp chat picked, sending to the Mac instead');
                warnedNoChat = true;
            }
            toMac = true;
        }
    }
    if (toMac) sendMacNotification(title, body);
}

/**
 * Event-bus listener mapping daemon events to notifications per user
 * settings. getSettings() re-reads settings.json on every call, so toggles
 * apply without a daemon restart.
 */
export function notifyForEvent(type: string, data: Record<string, unknown>): void {
    const prefs = getSettings().notifications;
    if (!prefs?.enabled) return;
    const to = prefs.destinations ?? {};
    if (type === 'torrent:completed' && prefs.torrent_completed) {
        deliver('Download complete', String(data.name ?? data.id ?? ''), to.torrent_completed);
    } else if (type === 'watchlist:match' && prefs.watchlist_match) {
        deliver('Watchlist match', `${data.title} → ${data.torrentName}`, to.watchlist_match);
    } else if (type === 'watchlist:results' && prefs.watchlist_match) {
        const n = Number(data.count ?? 0);
        deliver('Watchlist results', `${n} new result${n === 1 ? '' : 's'} · ${data.title}`, to.watchlist_match);
    } else if (type === 'watchlist:check_failed' && prefs.watchlist_match && data.notify) {
        deliver('Watchlist check failed', `${data.title}: ${data.error}`, to.watchlist_match);
    } else if (type === 'automation:failed' && prefs.automation_failed !== false && data.notify) {
        deliver(`Automation "${data.ruleName}" failed`, String(data.detail ?? ''), to.automation_failed);
    }
}
