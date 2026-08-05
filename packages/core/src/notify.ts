import { execFile } from 'child_process';
import { getSettings } from './config';
import { log } from './logging';

// `on run argv` passes title/body as argv items — torrent names never get
// interpolated into the script, so quotes and backslashes need no escaping.
const OSA_SCRIPT =
    'on run argv\n  display notification (item 2 of argv) with title (item 1 of argv)\nend run';

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
 * Event-bus listener mapping daemon events to macOS notifications per user
 * settings. getSettings() re-reads settings.json on every call, so toggles
 * apply without a daemon restart.
 */
export function notifyForEvent(type: string, data: Record<string, unknown>): void {
    const prefs = getSettings().notifications;
    if (!prefs?.enabled) return;
    if (type === 'torrent:completed' && prefs.torrent_completed) {
        sendMacNotification('Download complete', String(data.name ?? data.id ?? ''));
    } else if (type === 'watchlist:match' && prefs.watchlist_match) {
        sendMacNotification('Watchlist match', `${data.title} → ${data.torrentName}`);
    } else if (type === 'watchlist:results' && prefs.watchlist_match) {
        const n = Number(data.count ?? 0);
        sendMacNotification('Watchlist results', `${n} new result${n === 1 ? '' : 's'} · ${data.title}`);
    }
}
