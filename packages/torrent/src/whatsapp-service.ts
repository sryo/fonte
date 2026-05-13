import path from 'path';
import { Client, LocalAuth, Message } from 'whatsapp-web.js';
import { log, emitEvent, AITORRENT_HOME, enqueueMessage } from '@aitorrent/core';
import { getResponsesForChannel, ackResponse } from '@aitorrent/core';

const SESSION_DIR = path.join(AITORRENT_HOME, 'whatsapp-session');

export type WhatsAppStatus = 'disconnected' | 'connecting' | 'waiting_qr' | 'connected';

export class WhatsAppService {
    private client: Client | null = null;
    private _status: WhatsAppStatus = 'disconnected';
    private _qr: string | null = null;
    private responsePoller: ReturnType<typeof setInterval> | null = null;

    get status(): WhatsAppStatus { return this._status; }
    get qr(): string | null { return this._qr; }

    async start(): Promise<void> {
        if (this.client) return;
        this._status = 'connecting';

        this.client = new Client({
            authStrategy: new LocalAuth({ dataPath: SESSION_DIR }),
            puppeteer: {
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox'],
            },
        });

        this.client.on('qr', (qr: string) => {
            this._qr = qr;
            this._status = 'waiting_qr';
            emitEvent('whatsapp:qr', { qr });
            log('INFO', 'WhatsApp: QR code ready for scanning');
        });

        this.client.on('ready', () => {
            this._qr = null;
            this._status = 'connected';
            emitEvent('whatsapp:ready', {});
            log('INFO', 'WhatsApp: connected');
            this.startResponsePoller();
        });

        this.client.on('message', async (msg: Message) => {
            if (msg.from === 'status@broadcast') return;
            if (msg.fromMe) return;
            const text = msg.body?.trim();
            if (!text) return;

            const sender = (msg as any)._data?.notifyName || msg.from.split('@')[0];
            const chatId = msg.from;

            log('INFO', `WhatsApp message from ${sender}: ${text}`);

            enqueueMessage({
                channel: 'whatsapp',
                sender,
                senderId: chatId,
                message: text,
                messageId: `wa_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            });
        });

        this.client.on('disconnected', (reason: string) => {
            this._status = 'disconnected';
            this._qr = null;
            emitEvent('whatsapp:disconnected', { reason });
            log('INFO', `WhatsApp disconnected: ${reason}`);
            // Auto-reconnect after 5s
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

    async stop(): Promise<void> {
        this.stopResponsePoller();
        if (this.client) {
            try { await this.client.destroy(); } catch {}
            this.client = null;
        }
        this._status = 'disconnected';
        this._qr = null;
        log('INFO', 'WhatsApp: stopped');
    }

    getStatusInfo(): { status: WhatsAppStatus; qr?: string } {
        return {
            status: this._status,
            ...(this._qr ? { qr: this._qr } : {}),
        };
    }

    private startResponsePoller(): void {
        if (this.responsePoller) return;
        this.responsePoller = setInterval(async () => {
            if (!this.client || this._status !== 'connected') return;
            try {
                const responses = getResponsesForChannel('whatsapp');
                for (const resp of responses) {
                    const chatId = resp.sender_id || resp.senderId;
                    if (!chatId) continue;
                    try {
                        await this.client.sendMessage(chatId, resp.message);
                        ackResponse(resp.id);
                        log('INFO', `WhatsApp: sent response to ${chatId}`);
                    } catch (err) {
                        log('ERROR', `WhatsApp: send failed: ${(err as Error).message}`);
                    }
                }
            } catch {}
        }, 2000);
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
