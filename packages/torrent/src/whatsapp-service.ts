import fs from 'fs';
import path from 'path';
import { Client, LocalAuth, Message, MessageMedia, MessageTypes } from 'whatsapp-web.js';
import {
    log, emitEvent, AITORRENT_HOME, FILES_DIR, enqueueMessage,
    getResponsesForChannel, ackResponse, getSettings,
} from '@aitorrent/core';

const SESSION_DIR = path.join(AITORRENT_HOME, 'whatsapp-session');

const MEDIA_TYPES: string[] = [
    MessageTypes.IMAGE, MessageTypes.AUDIO, MessageTypes.VOICE,
    MessageTypes.VIDEO, MessageTypes.DOCUMENT, MessageTypes.STICKER,
];

const MIME_EXT: Record<string, string> = {
    'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp',
    'audio/ogg': '.ogg', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a',
    'video/mp4': '.mp4', 'application/pdf': '.pdf', 'text/plain': '.txt',
};

function extFromMime(mime?: string): string {
    if (!mime) return '.bin';
    return MIME_EXT[mime] || `.${mime.split('/')[1] || 'bin'}`;
}

export type WhatsAppStatus = 'disconnected' | 'connecting' | 'waiting_qr' | 'connected';

interface PendingMessage {
    message: Message;
    timestamp: number;
}

export interface ChatSummary {
    id: string;
    name: string;
    isGroup: boolean;
    unread: number;
    lastTimestamp?: number;
}

export class WhatsAppService {
    private client: Client | null = null;
    private _status: WhatsAppStatus = 'disconnected';
    private _qr: string | null = null;
    private responsePoller: ReturnType<typeof setInterval> | null = null;
    private pending = new Map<string, PendingMessage>();
    private outgoingIds = new Set<string>();
    private recentSentTexts = new Map<string, number>();  // text → ts, for self-send dedup
    private SEND_DEDUPE_MS = 15_000;
    private readyWatchdog: ReturnType<typeof setTimeout> | null = null;
    private READY_TIMEOUT_MS = 30_000;

    get status(): WhatsAppStatus { return this._status; }
    get qr(): string | null { return this._qr; }

    async start(): Promise<void> {
        if (this.client) return;
        this._status = 'connecting';

        this.client = new Client({
            authStrategy: new LocalAuth({ dataPath: SESSION_DIR }),
            puppeteer: {
                headless: 'new' as any,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu',
                ],
            },
        });

        this.client.on('loading_screen', (percent: number, message: string) => {
            log('INFO', `WhatsApp: loading ${percent}% — ${message}`);
        });

        this.client.on('qr', (qr: string) => {
            this._qr = qr;
            this._status = 'waiting_qr';
            emitEvent('whatsapp:qr', { qr });
            log('INFO', 'WhatsApp: QR code ready for scanning');
        });

        this.client.on('authenticated', () => {
            log('INFO', 'WhatsApp: authenticated (waiting for ready)');
            this.armReadyWatchdog();
        });

        this.client.on('change_state', (state: string) => {
            log('INFO', `WhatsApp: state → ${state}`);
        });

        this.client.on('ready', () => {
            this.clearReadyWatchdog();
            this._qr = null;
            this._status = 'connected';
            emitEvent('whatsapp:ready', {});
            log('INFO', 'WhatsApp: connected (ready)');
            this.startResponsePoller();
        });

        this.client.on('message_create', async (msg: Message) => {
            try { await this.handleIncoming(msg); }
            catch (err) { log('ERROR', `WhatsApp message handler: ${(err as Error).message}`); }
        });

        this.client.on('disconnected', (reason: string) => {
            this._status = 'disconnected';
            this._qr = null;
            emitEvent('whatsapp:disconnected', { reason });
            log('INFO', `WhatsApp disconnected: ${reason}`);
            setTimeout(() => {
                if (this.client) this.client.initialize().catch(() => {});
            }, 5000);
        });

        this.client.on('auth_failure', (msg: string) => {
            this._status = 'disconnected';
            this._qr = null;
            log('ERROR', `WhatsApp auth failed: ${msg}`);
        });

        await this.client.initialize();
    }

    private async handleIncoming(msg: Message): Promise<void> {
        if (msg.from === 'status@broadcast') return;

        const allowedChat = getSettings().whatsapp?.allowed_chat;
        if (!allowedChat) return;                  // null = ignore everything

        // Match against either side of the chat — for self-groups msg.from can be your own user id
        const chatId = (msg as any).id?.remote || msg.from;
        if (chatId !== allowedChat && msg.from !== allowedChat) return;

        // Skip our own bot replies; allow user-typed self-messages.
        // Two strategies: ID-based (no race when reply() resolves first) and text-based (catches the race).
        if (msg.fromMe) {
            const id = (msg as any).id?._serialized;
            if (id && this.outgoingIds.has(id)) {
                this.outgoingIds.delete(id);
                return;
            }
            const body = (msg.body || '').trim();
            if (body && this.wasRecentlySent(body)) return;
        }

        const hasMedia = msg.hasMedia && MEDIA_TYPES.includes(msg.type);
        const isChat = msg.type === 'chat';
        if (!isChat && !hasMedia) return;

        let text = (msg.body || '').trim();
        const sender = (msg as any)._data?.notifyName || msg.from.split('@')[0];
        const messageId = `wa_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

        const files: string[] = [];
        if (hasMedia) {
            const filePath = await this.downloadMedia(msg, messageId);
            if (filePath) files.push(filePath);
            if (msg.type === MessageTypes.STICKER && !text) text = '[Sticker]';
        }

        if (!text && files.length === 0) return;

        const body = files.length > 0
            ? (text ? `${text}\n\n${files.map(f => `[file: ${f}]`).join('\n')}` : files.map(f => `[file: ${f}]`).join('\n'))
            : text;

        log('INFO', `WhatsApp message from ${sender}: ${text.slice(0, 80)}${files.length > 0 ? ` [+${files.length} file(s)]` : ''}`);

        this.pending.set(messageId, { message: msg, timestamp: Date.now() });
        this.pruneStalePending();

        enqueueMessage({
            channel: 'whatsapp',
            sender,
            senderId: msg.from,
            message: body,
            messageId,
        });
    }

    private async downloadMedia(msg: Message, messageId: string): Promise<string | null> {
        try {
            const media = await msg.downloadMedia();
            if (!media || !media.data) return null;
            const ext = msg.type === MessageTypes.DOCUMENT && (msg as any)._data?.filename
                ? path.extname((msg as any)._data.filename)
                : extFromMime(media.mimetype);
            if (!fs.existsSync(FILES_DIR)) fs.mkdirSync(FILES_DIR, { recursive: true });
            const filename = `whatsapp_${messageId}${ext}`;
            const localPath = path.join(FILES_DIR, filename);
            fs.writeFileSync(localPath, Buffer.from(media.data, 'base64'));
            log('INFO', `WhatsApp: saved media ${filename} (${media.mimetype})`);
            return localPath;
        } catch (err) {
            log('ERROR', `WhatsApp: media download failed: ${(err as Error).message}`);
            return null;
        }
    }

    private pruneStalePending(): void {
        const cutoff = Date.now() - 10 * 60 * 1000;
        for (const [id, p] of this.pending) {
            if (p.timestamp < cutoff) this.pending.delete(id);
        }
    }

    async stop(): Promise<void> {
        this.clearReadyWatchdog();
        this.stopResponsePoller();
        if (this.client) {
            try { await this.client.destroy(); } catch {}
            this.client = null;
        }
        this._status = 'disconnected';
        this._qr = null;
        this.pending.clear();
        this.outgoingIds.clear();
        this.recentSentTexts.clear();
        log('INFO', 'WhatsApp: stopped');
    }

    getStatusInfo(): { status: WhatsAppStatus; qr?: string } {
        return {
            status: this._status,
            ...(this._qr ? { qr: this._qr } : {}),
        };
    }

    async getChats(): Promise<ChatSummary[]> {
        if (!this.client || this._status !== 'connected') return [];
        const chats = await this.client.getChats();
        return chats.map(c => ({
            id: c.id._serialized,
            name: c.name || c.id.user,
            isGroup: c.isGroup,
            unread: c.unreadCount,
            lastTimestamp: c.timestamp,
        })).sort((a, b) => (b.lastTimestamp || 0) - (a.lastTimestamp || 0));
    }

    private startResponsePoller(): void {
        if (this.responsePoller) return;
        this.responsePoller = setInterval(async () => {
            if (!this.client || this._status !== 'connected') return;
            try {
                const responses = getResponsesForChannel('whatsapp');
                for (const resp of responses) {
                    await this.deliverResponse(resp);
                }
            } catch {}
        }, 2000);
    }

    private async deliverResponse(resp: any): Promise<void> {
        const senderId = resp.sender_id || resp.senderId;
        if (!senderId || !this.client) return;
        const messageId = resp.message_id || resp.messageId;
        const pending = messageId ? this.pending.get(messageId) : undefined;
        const destination = pending ? ((pending.message as any).id?.remote || senderId) : senderId;
        const files: string[] = resp.files ? (typeof resp.files === 'string' ? JSON.parse(resp.files) : resp.files) : [];

        const trackSent = (sent: any) => {
            const sid = sent?.id?._serialized;
            if (sid) this.outgoingIds.add(sid);
        };

        try {
            for (const file of files) {
                if (!fs.existsSync(file)) continue;
                const media = MessageMedia.fromFilePath(file);
                const sent = pending ? await pending.message.reply(media) : await this.client.sendMessage(senderId, media);
                trackSent(sent);
            }

            if (resp.message) {
                // Pre-mark to handle the race where message_create fires before reply() resolves
                this.markRecentSent(resp.message);
                const sent = pending ? await pending.message.reply(resp.message) : await this.client.sendMessage(senderId, resp.message);
                trackSent(sent);
            }

            ackResponse(resp.id);
            // Keep pending alive — agents may emit multiple responses per messageId (streaming, follow-ups).
            // Pruned by pruneStalePending after 10 min.
            log('INFO', `WhatsApp: sent ${pending ? 'reply' : 'message'} to ${destination}${files.length > 0 ? ` [+${files.length} file(s)]` : ''}`);
        } catch (err) {
            log('ERROR', `WhatsApp: send failed: ${(err as Error).message}`);
        }
    }

    private markRecentSent(text: string): void {
        const trimmed = text.trim();
        if (!trimmed) return;
        this.recentSentTexts.set(trimmed, Date.now());
        // Prune
        const cutoff = Date.now() - this.SEND_DEDUPE_MS;
        for (const [t, ts] of this.recentSentTexts) {
            if (ts < cutoff) this.recentSentTexts.delete(t);
        }
    }

    private wasRecentlySent(text: string): boolean {
        const ts = this.recentSentTexts.get(text);
        if (!ts) return false;
        if (Date.now() - ts > this.SEND_DEDUPE_MS) {
            this.recentSentTexts.delete(text);
            return false;
        }
        // Consume — one match, one delete (handles streaming responses with same text rare)
        this.recentSentTexts.delete(text);
        return true;
    }

    private stopResponsePoller(): void {
        if (this.responsePoller) {
            clearInterval(this.responsePoller);
            this.responsePoller = null;
        }
    }

    private armReadyWatchdog(): void {
        this.clearReadyWatchdog();
        this.readyWatchdog = setTimeout(() => {
            if (this._status === 'connected') return;
            log('ERROR', `WhatsApp: ready event never fired after authenticated. Wiping session and re-pairing.`);
            this.recoverByWipe().catch(err => log('ERROR', `WhatsApp recover failed: ${(err as Error).message}`));
        }, this.READY_TIMEOUT_MS);
    }

    private clearReadyWatchdog(): void {
        if (this.readyWatchdog) {
            clearTimeout(this.readyWatchdog);
            this.readyWatchdog = null;
        }
    }

    private async recoverByWipe(): Promise<void> {
        try { if (this.client) await this.client.destroy(); } catch {}
        this.client = null;
        this._status = 'disconnected';
        this._qr = null;
        try { fs.rmSync(SESSION_DIR, { recursive: true, force: true }); } catch {}
        log('INFO', 'WhatsApp: session wiped, starting fresh');
        await this.start();
    }
}

let instance: WhatsAppService | null = null;
export function getWhatsAppService(): WhatsAppService {
    if (!instance) instance = new WhatsAppService();
    return instance;
}
