#!/usr/bin/env node
import * as p from '@clack/prompts';
import { apiRequest } from './shared.ts';

async function sendMessage(message: string, source = 'cli') {
    try {
        const result = await apiRequest('POST', '/api/message', { message, channel: 'cli', sender: source });
        if (result.ok) {
            console.log(`Message enqueued: ${result.messageId}`);
        } else {
            console.error(`Failed to enqueue message: ${result.error || JSON.stringify(result)}`);
        }
    } catch (err) {
        console.error(`Failed to send message: ${(err as Error).message}`);
        process.exit(1);
    }
}

// --- CLI dispatch ---

const command = process.argv[2];
const arg = process.argv[3];

switch (command) {
    case 'send':
        if (!arg) {
            p.log.error('Usage: messaging send <message>');
            process.exit(1);
        }
        sendMessage(arg);
        break;
    default:
        p.log.error(`Unknown messaging command: ${command}`);
        process.exit(1);
}
