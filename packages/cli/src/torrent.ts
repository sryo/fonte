#!/usr/bin/env node
import * as p from '@clack/prompts';
import http from 'http';

const API_PORT = process.env.AITORRENT_API_PORT || '3777';
const API_URL = `http://localhost:${API_PORT}`;

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function apiRequest<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : undefined;
        const url = new URL(`${API_URL}${path}`);

        const req = http.request({
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method,
            headers: {
                'Content-Type': 'application/json',
                ...(payload ? { 'Content-Length': String(Buffer.byteLength(payload)) } : {}),
            },
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch {
                    reject(new Error(`Invalid JSON response: ${data}`));
                }
            });
        });

        req.on('error', (err) => {
            reject(new Error(`API request failed: ${err.message}. Is the daemon running? (aitorrent start)`));
        });

        if (payload) req.write(payload);
        req.end();
    });
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatSpeed(bytesPerSec: number): string {
    return `${formatBytes(bytesPerSec)}/s`;
}

function formatProgress(progress: number): string {
    const pct = (progress * 100).toFixed(1);
    const filled = Math.round(progress * 20);
    const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);
    return `[${bar}] ${pct}%`;
}

function statusColor(status: string): string {
    const colors: Record<string, string> = {
        downloading: '\x1b[36m', // cyan
        seeding: '\x1b[32m',     // green
        completed: '\x1b[32m',   // green
        paused: '\x1b[33m',      // yellow
        adding: '\x1b[34m',      // blue
        error: '\x1b[31m',       // red
    };
    return `${colors[status] || ''}${status}\x1b[0m`;
}

// ── Commands ──────────────────────────────────────────────────────────────────

async function torrentAdd(source: string) {
    const result = await apiRequest('POST', '/api/torrents', { magnetUri: source });
    if (result.ok) {
        const t = result.torrent;
        console.log(`Added torrent: ${t.name || t.infoHash}`);
        console.log(`  ID: ${t.id}`);
        console.log(`  Status: ${t.status}`);
        if (t.size > 0) console.log(`  Size: ${formatBytes(t.size)}`);
    } else {
        p.log.error(result.error || 'Failed to add torrent');
        process.exit(1);
    }
}

async function torrentList() {
    const result = await apiRequest('GET', '/api/torrents');
    if (!result.ok) {
        p.log.error(result.error || 'Failed to list torrents');
        process.exit(1);
    }

    const torrents = result.torrents;
    if (torrents.length === 0) {
        console.log('No torrents.');
        return;
    }

    // Header
    console.log(
        padRight('ID', 14) +
        padRight('Name', 36) +
        padRight('Size', 10) +
        padRight('Progress', 30) +
        padRight('Speed', 14) +
        'Status'
    );
    console.log('─'.repeat(110));

    for (const t of torrents) {
        const name = (t.name || t.infoHash || '').substring(0, 34);
        const speed = t.status === 'downloading' ? formatSpeed(t.downloadSpeed) : '';
        console.log(
            padRight(t.id, 14) +
            padRight(name, 36) +
            padRight(formatBytes(t.size), 10) +
            padRight(formatProgress(t.progress), 30) +
            padRight(speed, 14) +
            statusColor(t.status)
        );
    }

    // Summary
    const statsResult = await apiRequest('GET', '/api/torrents/stats');
    if (statsResult.ok) {
        console.log('');
        console.log(`Total: ${statsResult.totalTorrents} | Active: ${statsResult.activeTorrents} | ↓ ${formatSpeed(statsResult.downloadSpeed)} ↑ ${formatSpeed(statsResult.uploadSpeed)}`);
    }
}

async function torrentStatus(id: string) {
    const result = await apiRequest('GET', `/api/torrents/${id}`);
    if (!result.ok) {
        p.log.error(result.error || 'Torrent not found');
        process.exit(1);
    }

    const t = result.torrent;
    console.log(`Torrent: ${t.name || 'Unknown'}`);
    console.log(`  ID:        ${t.id}`);
    console.log(`  Info Hash: ${t.infoHash}`);
    console.log(`  Status:    ${statusColor(t.status)}`);
    console.log(`  Progress:  ${formatProgress(t.progress)}`);
    console.log(`  Size:      ${formatBytes(t.size)}`);
    console.log(`  Downloaded:${formatBytes(t.downloaded)}`);
    console.log(`  Uploaded:  ${formatBytes(t.uploaded)}`);
    console.log(`  Speed:     ↓ ${formatSpeed(t.downloadSpeed)} ↑ ${formatSpeed(t.uploadSpeed)}`);
    console.log(`  Peers:     ${t.numPeers}`);
    console.log(`  Path:      ${t.savePath}`);
    console.log(`  Added:     ${new Date(t.addedAt).toLocaleString()}`);
    if (t.completedAt) console.log(`  Completed: ${new Date(t.completedAt).toLocaleString()}`);
    if (t.errorMessage) console.log(`  Error:     ${t.errorMessage}`);

    // Show files
    const filesResult = await apiRequest('GET', `/api/torrents/${id}/files`);
    if (filesResult.ok && filesResult.files.length > 0) {
        console.log(`\n  Files (${filesResult.files.length}):`);
        for (const f of filesResult.files) {
            const sel = f.selected ? '✓' : '✗';
            console.log(`    ${sel} ${f.name} (${formatBytes(f.size)}) ${(f.progress * 100).toFixed(0)}%`);
        }
    }
}

async function torrentPause(id: string) {
    const result = await apiRequest('POST', `/api/torrents/${id}/pause`);
    if (result.ok) {
        console.log(`Paused torrent: ${id}`);
    } else {
        p.log.error(result.error || 'Failed to pause torrent');
        process.exit(1);
    }
}

async function torrentResume(id: string) {
    const result = await apiRequest('POST', `/api/torrents/${id}/resume`);
    if (result.ok) {
        console.log(`Resumed torrent: ${id}`);
    } else {
        p.log.error(result.error || 'Failed to resume torrent');
        process.exit(1);
    }
}

async function torrentRemove(id: string, deleteFiles: boolean) {
    const qs = deleteFiles ? '?deleteFiles=true' : '';
    const result = await apiRequest('DELETE', `/api/torrents/${id}${qs}`);
    if (result.ok) {
        console.log(`Removed torrent: ${id}${deleteFiles ? ' (files deleted)' : ''}`);
    } else {
        p.log.error(result.error || 'Failed to remove torrent');
        process.exit(1);
    }
}

async function torrentConfig(key?: string, value?: string) {
    if (!key) {
        // Show current config
        const result = await apiRequest('GET', '/api/torrents/config');
        if (result.ok) {
            console.log('Torrent Configuration:');
            for (const [k, v] of Object.entries(result.config)) {
                console.log(`  ${k}: ${v}`);
            }
        } else {
            p.log.error(result.error || 'Failed to get config');
        }
        return;
    }

    if (!value) {
        p.log.error(`Usage: aitorrent torrent config <key> <value>`);
        process.exit(1);
    }

    // Parse value: numbers, booleans, strings
    let parsed: any = value;
    if (value === 'true') parsed = true;
    else if (value === 'false') parsed = false;
    else if (/^\d+(\.\d+)?$/.test(value)) parsed = parseFloat(value);

    const result = await apiRequest('PUT', '/api/torrents/config', { [key]: parsed });
    if (result.ok) {
        console.log(`Updated ${key} = ${parsed}`);
    } else {
        p.log.error(result.error || 'Failed to update config');
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function padRight(str: string, len: number): string {
    return str.length >= len ? str.substring(0, len) : str + ' '.repeat(len - str.length);
}

// ── CLI dispatch ──────────────────────────────────────────────────────────────

const command = process.argv[2];
const arg1 = process.argv[3];
const arg2 = process.argv[4];

(async () => {
    try {
        switch (command) {
            case 'add':
                if (!arg1) {
                    p.log.error('Usage: aitorrent torrent add <magnet_uri_or_path>');
                    process.exit(1);
                }
                await torrentAdd(arg1);
                break;
            case 'list': case 'ls':
                await torrentList();
                break;
            case 'status':
                if (!arg1) {
                    p.log.error('Usage: aitorrent torrent status <id>');
                    process.exit(1);
                }
                await torrentStatus(arg1);
                break;
            case 'pause':
                if (!arg1) {
                    p.log.error('Usage: aitorrent torrent pause <id>');
                    process.exit(1);
                }
                await torrentPause(arg1);
                break;
            case 'resume':
                if (!arg1) {
                    p.log.error('Usage: aitorrent torrent resume <id>');
                    process.exit(1);
                }
                await torrentResume(arg1);
                break;
            case 'remove': case 'rm':
                if (!arg1) {
                    p.log.error('Usage: aitorrent torrent remove <id> [--delete-files]');
                    process.exit(1);
                }
                await torrentRemove(arg1, process.argv.includes('--delete-files'));
                break;
            case 'config':
                await torrentConfig(arg1, arg2);
                break;
            default:
                console.log('Usage: aitorrent torrent {add|list|status|pause|resume|remove|config}');
                process.exit(1);
        }
    } catch (err) {
        p.log.error((err as Error).message);
        process.exit(1);
    }
})();
