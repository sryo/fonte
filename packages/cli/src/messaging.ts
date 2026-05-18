#!/usr/bin/env node
import * as p from '@clack/prompts';
import http from 'http';

const API_PORT = process.env.FONTE_API_PORT || '3777';
const API_URL = `http://localhost:${API_PORT}`;

function sendMessage(message: string, source = 'cli') {
    const payload = JSON.stringify({ message, channel: 'cli', sender: source });

    const url = new URL(`${API_URL}/api/message`);
    const req = http.request({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
        },
    }, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
            try {
                const result = JSON.parse(body);
                if (result.ok) {
                    console.log(`Message enqueued: ${result.messageId}`);
                } else {
                    console.error(`Failed to enqueue message: ${body}`);
                }
            } catch {
                console.error(`Failed to parse response: ${body}`);
            }
        });
    });

    req.on('error', (err) => {
        console.error(`Failed to send message: ${err.message}`);
        process.exit(1);
    });

    req.write(payload);
    req.end();
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
