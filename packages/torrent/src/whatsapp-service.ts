import fs from 'fs';
import path from 'path';
import pino from 'pino';
import {
    makeWASocket,
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    fetchLatestWaWebVersion,
    DisconnectReason,
    Browsers,
    downloadMediaMessage,
} from '@whiskeysockets/baileys';
import type { WASocket, WAMessage } from '@whiskeysockets/baileys';
import {
    log, emitEvent, AITORRENT_HOME, FILES_DIR, enqueueMessage,
    getResponsesForChannel, ackResponse, getSettings,
} from '@fonte/core';

// New auth dir (Baileys multi-file state — replaces the old Chrome profile dir)
const AUTH_DIR = path.join(AITORRENT_HOME, 'whatsapp-auth');
const LEGACY_SESSION_DIR = path.join(AITORRENT_HOME, 'whatsapp-session');

const MIME_EXT: Record<string, string> = {
    'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp',
    'audio/ogg': '.ogg', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/aac': '.aac',
    'video/mp4': '.mp4', 'application/pdf': '.pdf', 'text/plain': '.txt',
};

function extFromMime(mime?: string): string {
    if (!mime) return '.bin';
    return MIME_EXT[mime] || `.${mime.split('/')[1] || 'bin'}`;
}

export type WhatsAppStatus = 'disconnected' | 'connecting' | 'waiting_qr' | 'connected';

interface PendingMessage {
    message: WAMessage;
    timestamp: number;
}

export interface ChatSummary {
    id: string;
    name: string;
    isGroup: boolean;
    unread: number;
    lastTimestamp?: number;
}

const baileysLogger = pino({ level: 'silent' });

// Fetched once per process; reused across reconnects to avoid repeated network calls
let cachedWaVersion: [number, number, number] | undefined;

export class WhatsAppService {
    private sock: WASocket | null = null;
    private _status: WhatsAppStatus = 'disconnected';
    private _qr: string | null = null;
    private saveCreds: (() => Promise<void>) | null = null;
    private responsePoller: ReturnType<typeof setInterval> | null = null;
    private pending = new Map<string, PendingMessage>();
    private recentSentTexts = new Map<string, number>();
    private SEND_DEDUPE_MS = 15_000;
    // Cache settings.whatsapp.allowed_chat to avoid disk reads on every message
    private allowedChatCache: { value: string | null; ts: number } = { value: null, ts: 0 };
    private SETTINGS_CACHE_MS = 5_000;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private starting = false;

    get status(): WhatsAppStatus { return this._status; }
    get qr(): string | null { return this._qr; }

    async start(): Promise<void> {
        if (this.sock || this.starting) return;
        this.starting = true;
        this._status = 'connecting';
        try {
            await this.connectInternal();
        } finally {
            this.starting = false;
        }
    }

    private async connectInternal(): Promise<void> {
        // Clean up legacy Chrome profile from the old whatsapp-web.js implementation
        try {
            if (fs.existsSync(LEGACY_SESSION_DIR)) {
                fs.rmSync(LEGACY_SESSION_DIR, { recursive: true, force: true });
                log('INFO', 'WhatsApp: removed legacy session dir (whatsapp-web.js)');
            }
        } catch {}

        fs.mkdirSync(AUTH_DIR, { recursive: true });
        const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
        this.saveCreds = saveCreds;

        if (!cachedWaVersion) {
            const versionResult = await fetchLatestWaWebVersion({}).catch(() => null);
            cachedWaVersion = versionResult?.version as [number, number, number] | undefined;
        }
        const version = cachedWaVersion;

        this.sock = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
            },
            printQRInTerminal: false,
            logger: baileysLogger,
            browser: Browsers.macOS('Fonte'),
            markOnlineOnConnect: false,
            syncFullHistory: false,
        });

        this.sock.ev.on('creds.update', saveCreds);

        this.sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                this._qr = qr;
                this._status = 'waiting_qr';
                emitEvent('whatsapp:qr', { qr });
                log('INFO', 'WhatsApp: QR code ready for scanning');
            }

            if (connection === 'open') {
                this._qr = null;
                this._status = 'connected';
                emitEvent('whatsapp:ready', {});
                log('INFO', 'WhatsApp: connected');
                this.startResponsePoller();
            }

            if (connection === 'close') {
                this.stopResponsePoller();
                const code = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
                const loggedOut = code === DisconnectReason.loggedOut;
                this._status = 'disconnected';
                emitEvent('whatsapp:disconnected', { reason: code || 'unknown' });
                log('INFO', `WhatsApp: disconnected (code=${code ?? 'n/a'}, loggedOut=${loggedOut})`);

                if (loggedOut) {
                    try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); } catch {}
                    log('INFO', 'WhatsApp: logged out — auth wiped, fresh QR will be needed');
                    this.sock = null;
                    return;
                }

                this.sock = null;
                this.scheduleReconnect();
            }
        });

        this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify' && type !== 'append') return;
            for (const msg of messages) {
                try { await this.handleIncoming(msg); }
                catch (err) { log('ERROR', `WhatsApp message handler: ${(err as Error).message}`); }
            }
        });
    }

    private scheduleReconnect(): void {
        if (this.reconnectTimer) return;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            log('INFO', 'WhatsApp: attempting reconnect');
            this.connectInternal().catch(err => {
                log('ERROR', `WhatsApp reconnect failed: ${(err as Error).message}`);
                this.scheduleReconnect();
            });
        }, 5000);
    }

    async requestPairingCode(phoneNumber: string): Promise<string> {
        if (!this.sock) throw new Error('WhatsApp not started — call start() first');
        // Strip non-digits (UI may send "+1 415 …")
        const digits = phoneNumber.replace(/\D/g, '');
        if (!digits) throw new Error('Phone number must contain digits');
        const code = await this.sock.requestPairingCode(digits);
        log('INFO', `WhatsApp: pairing code requested for ${digits.slice(0, 3)}…`);
        return code;
    }

    private async handleIncoming(msg: WAMessage): Promise<void> {
        if (!msg.message) return;
        const rawJid = msg.key.remoteJid;
        if (!rawJid || rawJid === 'status@broadcast') return;

        const allowedChat = this.getAllowedChat();
        if (!allowedChat || rawJid !== allowedChat) return;

        const m = msg.message;
        const text = (
            m.conversation
            || m.extendedTextMessage?.text
            || m.imageMessage?.caption
            || m.videoMessage?.caption
            || m.documentMessage?.caption
            || ''
        ).trim();

        const hasMedia = !!(m.imageMessage || m.videoMessage || m.audioMessage || m.documentMessage || m.stickerMessage);
        if (!text && !hasMedia) return;

        // Bot's own replies arrive as fromMe; recentSentTexts dedup catches the
        // race between the send promise resolving and the upsert event firing.
        if (msg.key.fromMe && text && this.wasRecentlySent(text)) return;

        const sender = msg.pushName || (msg.key.participant || rawJid).split('@')[0];
        const messageId = `wa_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

        const files: string[] = [];
        if (hasMedia) {
            const filePath = await this.downloadMedia(msg, messageId);
            if (filePath) files.push(filePath);
        }

        const head = text || (m.stickerMessage ? '[Sticker]' : '');
        const fileRefs = files.map(f => `[file: ${f}]`).join('\n');
        const body = [head, fileRefs].filter(Boolean).join('\n\n');

        if (!body) return;

        log('INFO', `WhatsApp message from ${sender}: ${text.slice(0, 80)}${files.length > 0 ? ` [+${files.length} file(s)]` : ''}`);

        this.pending.set(messageId, { message: msg, timestamp: Date.now() });
        this.pruneStalePending();

        enqueueMessage({
            channel: 'whatsapp',
            sender,
            senderId: rawJid,
            message: body,
            messageId,
        });
    }

    private async downloadMedia(msg: WAMessage, messageId: string): Promise<string | null> {
        try {
            const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: baileysLogger, reuploadRequest: this.sock!.updateMediaMessage });
            if (!buffer) return null;

            const m = msg.message!;
            let mime: string | undefined;
            let suggestedExt: string | undefined;
            if (m.imageMessage) mime = m.imageMessage.mimetype || undefined;
            else if (m.videoMessage) mime = m.videoMessage.mimetype || undefined;
            else if (m.audioMessage) mime = m.audioMessage.mimetype || undefined;
            else if (m.stickerMessage) mime = m.stickerMessage.mimetype || undefined;
            else if (m.documentMessage) {
                mime = m.documentMessage.mimetype || undefined;
                if (m.documentMessage.fileName) suggestedExt = path.extname(m.documentMessage.fileName) || undefined;
            }
            const ext = suggestedExt || extFromMime(mime);
            fs.mkdirSync(FILES_DIR, { recursive: true });
            const filename = `whatsapp_${messageId}${ext}`;
            const localPath = path.join(FILES_DIR, filename);
            fs.writeFileSync(localPath, buffer as Buffer);
            log('INFO', `WhatsApp: saved media ${filename} (${mime || 'unknown'})`);
            return localPath;
        } catch (err) {
            log('ERROR', `WhatsApp: media download failed: ${(err as Error).message}`);
            return null;
        }
    }

    private markRecentSent(text: string): void {
        const trimmed = text.trim();
        if (!trimmed) return;
        this.recentSentTexts.set(trimmed, Date.now());
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
        this.recentSentTexts.delete(text);
        return true;
    }

    private getAllowedChat(): string | null {
        const now = Date.now();
        if (now - this.allowedChatCache.ts > this.SETTINGS_CACHE_MS) {
            this.allowedChatCache = {
                value: getSettings().whatsapp?.allowed_chat ?? null,
                ts: now,
            };
        }
        return this.allowedChatCache.value;
    }

    private pruneStalePending(): void {
        const cutoff = Date.now() - 10 * 60 * 1000;
        for (const [id, p] of this.pending) {
            if (p.timestamp < cutoff) this.pending.delete(id);
        }
    }

    async stop(): Promise<void> {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.stopResponsePoller();
        if (this.sock) {
            try { await this.sock.logout(); } catch {}
            try { this.sock.end(undefined); } catch {}
            this.sock = null;
        }
        this._status = 'disconnected';
        this._qr = null;
        this.pending.clear();
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
        if (!this.sock || this._status !== 'connected') return [];
        try {
            const groups = await this.sock.groupFetchAllParticipating();
            const groupSummaries: ChatSummary[] = Object.values(groups).map(g => ({
                id: g.id,
                name: g.subject || g.id,
                isGroup: true,
                unread: 0,
                lastTimestamp: g.creation || undefined,
            }));

            // Include self-chat (Message Yourself) as the user's own number
            const selfSummaries: ChatSummary[] = [];
            const userId = this.sock.user?.id;
            if (userId) {
                const phone = userId.split(':')[0].split('@')[0];
                const selfJid = `${phone}@s.whatsapp.net`;
                selfSummaries.push({
                    id: selfJid,
                    name: 'Message Yourself',
                    isGroup: false,
                    unread: 0,
                });
            }

            return [...selfSummaries, ...groupSummaries].sort((a, b) => (b.lastTimestamp || 0) - (a.lastTimestamp || 0));
        } catch (err) {
            log('ERROR', `WhatsApp: getChats failed: ${(err as Error).message}`);
            return [];
        }
    }

    private startResponsePoller(): void {
        if (this.responsePoller) return;
        this.responsePoller = setInterval(async () => {
            if (!this.sock || this._status !== 'connected') return;
            try {
                const responses = getResponsesForChannel('whatsapp');
                for (const resp of responses) {
                    await this.deliverResponse(resp);
                }
            } catch {}
        }, 2000);
    }

    private async deliverResponse(resp: any): Promise<void> {
        const senderJid = (resp.sender_id || resp.senderId) as string | undefined;
        if (!senderJid || !this.sock) return;
        const messageId = resp.message_id || resp.messageId;
        const pending = messageId ? this.pending.get(messageId) : undefined;
        const destinationJid = pending?.message.key.remoteJid || senderJid;
        const files: string[] = resp.files ? (typeof resp.files === 'string' ? JSON.parse(resp.files) : resp.files) : [];

        try {
            for (const file of files) {
                if (!fs.existsSync(file)) continue;
                const ext = path.extname(file).toLowerCase();
                const payload = this.buildMediaPayload(file, ext);
                if (!payload) continue;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                await this.sock.sendMessage(destinationJid, payload as any, pending ? { quoted: pending.message } : undefined);
            }

            if (resp.message) {
                this.markRecentSent(resp.message);
                await this.sock.sendMessage(destinationJid, { text: resp.message }, pending ? { quoted: pending.message } : undefined);
            }

            ackResponse(resp.id);
            // pending stays for the message-id lifetime — agents emit multiple chunks
            log('INFO', `WhatsApp: sent ${pending ? 'reply' : 'message'} to ${destinationJid}${files.length > 0 ? ` [+${files.length} file(s)]` : ''}`);
        } catch (err) {
            log('ERROR', `WhatsApp: send failed: ${(err as Error).message}`);
        }
    }

    private buildMediaPayload(filePath: string, ext: string): Record<string, unknown> | null {
        const buf = fs.readFileSync(filePath);
        const name = path.basename(filePath);
        if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext)) return { image: buf };
        if (['.mp4', '.mov'].includes(ext)) return { video: buf };
        if (['.mp3', '.ogg', '.m4a', '.aac'].includes(ext)) return { audio: buf, mimetype: ext === '.mp3' ? 'audio/mpeg' : 'audio/ogg' };
        return { document: buf, fileName: name, mimetype: 'application/octet-stream' };
    }

    private stopResponsePoller(): void {
        if (this.responsePoller) {
            clearInterval(this.responsePoller);
            this.responsePoller = null;
        }
    }
}

let instance: WhatsAppService | null = null;
export function getWhatsAppService(): WhatsAppService {
    if (!instance) instance = new WhatsAppService();
    return instance;
}
