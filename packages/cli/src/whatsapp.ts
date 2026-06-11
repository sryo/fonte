#!/usr/bin/env node
/**
 * Fonte WhatsApp Channel
 *
 * Connects to WhatsApp Web via QR code, listens for messages,
 * forwards them to the Fonte API, and sends responses back.
 *
 * Usage: node whatsapp.js
 */

import { Client, LocalAuth, Message } from 'whatsapp-web.js';
// @ts-ignore — no type declarations
import qrcode from 'qrcode-terminal';
import path from 'path';
import { apiRequest, readSettings } from './shared.ts';

const FONTE_HOME = process.env.FONTE_HOME || path.join(require('os').homedir(), '.fonte');
const SESSION_DIR = path.join(FONTE_HOME, 'whatsapp-session');

function sendToAgent(message: string, sender: string, chatId: string): Promise<any> {
    return apiRequest('POST', '/api/message', {
        message,
        channel: 'whatsapp',
        sender,
        senderId: chatId,
    });
}

// ── Poll for responses ──────────────────────────────────────────────────────

async function pollResponses(client: Client): Promise<void> {
    try {
        const data = await apiRequest<any>('GET', '/api/responses/pending?channel=whatsapp') as any;
        const responses = data?.responses || data || [];

        if (!Array.isArray(responses)) return;

        for (const resp of responses) {
            try {
                const chatId = resp.sender_id || resp.senderId;
                if (!chatId) continue;

                await client.sendMessage(chatId, resp.message);

                // Acknowledge delivery
                if (resp.id) {
                    await apiRequest('POST', `/api/responses/${resp.id}/ack`);
                }

                console.log(`[WhatsApp] Sent response to ${chatId}`);
            } catch (err) {
                console.error(`[WhatsApp] Failed to send response:`, (err as Error).message);
            }
        }
    } catch {
        // API not available, skip
    }
}

// ── Main ────────────────────────────────────────────────────────────────────

console.log('');
console.log('  Fonte WhatsApp Channel');
console.log('  ─────────────────────────');
console.log('');

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: SESSION_DIR }),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
});

client.on('qr', (qr: string) => {
    console.log('  Scan this QR code with WhatsApp:');
    console.log('');
    qrcode.generate(qr, { small: true });
    console.log('');
    console.log('  Open WhatsApp → Settings → Linked Devices → Link a Device');
    console.log('');
});

client.on('ready', () => {
    console.log('  WhatsApp connected!');
    console.log('  Messages from the chat in settings.whatsapp.allowed_chat control Fonte.');
    console.log('  Messages from any other chat are ignored (their chat id is logged here).');
    console.log('');

    // Start polling for responses every 2 seconds
    setInterval(() => pollResponses(client), 2000);
});

client.on('message', async (msg: Message) => {
    // Ignore status broadcasts and own messages
    if (msg.from === 'status@broadcast') return;
    if (msg.fromMe) return;

    const chatId = msg.from;
    const sender = (msg as any)._data?.notifyName || msg.from.split('@')[0];
    const text = msg.body?.trim();

    if (!text) return;

    // Only the configured chat may talk to the agent (settings.whatsapp.allowed_chat;
    // null/missing = ignore all). Re-read per message so changes apply without restart.
    const allowedChat = readSettings().whatsapp?.allowed_chat ?? null;
    if (!allowedChat || chatId !== allowedChat) {
        console.log(`[WhatsApp] Ignoring message from non-approved chat ${chatId} (set whatsapp.allowed_chat to approve)`);
        return;
    }

    console.log(`[WhatsApp] ${sender}: ${text}`);

    // Forward to Fonte agent
    try {
        const result = await sendToAgent(text, sender, chatId);
        if (result?.ok) {
            console.log(`[WhatsApp] Message queued: ${result.messageId}`);
        } else {
            await msg.reply('Could not process your request. Is the Fonte daemon running?');
        }
    } catch (err) {
        console.error(`[WhatsApp] API error:`, (err as Error).message);
        await msg.reply('Fonte daemon is not reachable. Start it with: fonte start');
    }
});

client.on('disconnected', (reason: string) => {
    console.log(`[WhatsApp] Disconnected: ${reason}`);
    console.log('[WhatsApp] Restarting in 5 seconds...');
    setTimeout(() => client.initialize(), 5000);
});

client.on('auth_failure', (msg: string) => {
    console.error(`[WhatsApp] Auth failed: ${msg}`);
    console.error('[WhatsApp] Delete the session and try again:');
    console.error(`  rm -rf ${SESSION_DIR}`);
    process.exit(1);
});

// Start
client.initialize();

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n[WhatsApp] Shutting down...');
    await client.destroy();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await client.destroy();
    process.exit(0);
});
