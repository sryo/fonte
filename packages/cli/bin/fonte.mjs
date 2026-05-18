#!/usr/bin/env node

import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

// ── Constants ────────────────────────────────────────────────────────────────

const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const BLUE = '\x1b[34m';
const NC = '\x1b[0m';

const BANNER = `
  █▀█ █   ▀█▀ █▀█ █▀▄ █▀▄ █▀▀ █▄ █ ▀█▀
  █▀█ █    █  █ █ █▀▄ █▀▄ █▀▀ █ ▀█  █
  ▀ ▀ ▀    ▀   ▀  ▀ ▀ ▀ ▀ ▀▀▀ ▀  ▀  ▀
`;

function log(color, msg) {
    process.stdout.write(`${color}${msg}${NC}\n`);
}

const REPO_ROOT = path.resolve(new URL('.', import.meta.url).pathname, '../../..');
const CLI_DIR = path.join(REPO_ROOT, 'packages/cli/dist');

// ── CLI Script Runner ────────────────────────────────────────────────────────

function runCliScript(script, args) {
    const scriptPath = path.join(CLI_DIR, script);
    const child = spawn('node', [scriptPath, ...args], { stdio: 'inherit' });
    child.on('exit', (code) => process.exit(code || 0));
}

// ── CLI Dispatch ─────────────────────────────────────────────────────────────

const command = process.argv[2] || 'start';
const restArgs = process.argv.slice(3);

console.log(BANNER);

switch (command) {
    // ── Daemon ──────────────────────────────────────────────────────────────

    case 'start':
        runCliScript('daemon.js', ['start', '--open']);
        break;

    case 'stop':
        runCliScript('daemon.js', ['stop']);
        break;

    case 'restart':
        runCliScript('daemon.js', ['restart']);
        break;

    case 'status':
        runCliScript('daemon.js', ['status']);
        break;

    // ── Torrents ────────────────────────────────────────────────────────────

    case 'torrent':
        if (!restArgs[0]) {
            console.log('Usage: fonte torrent {add|list|status|pause|resume|remove|config}');
            process.exit(1);
        }
        runCliScript('torrent.js', restArgs);
        break;

    // ── Watchlist ────────────────────────────────────────────────────────────

    case 'watchlist':
        if (!restArgs[0]) {
            console.log('Usage: fonte watchlist {add|list|remove|check|search}');
            process.exit(1);
        }
        runCliScript('watchlist.js', restArgs);
        break;

    // ── Subtitles ───────────────────────────────────────────────────────────

    case 'subtitle':
        if (!restArgs[0]) {
            console.log('Usage: fonte subtitle {fetch|list|translate}');
            process.exit(1);
        }
        runCliScript('subtitle.js', restArgs);
        break;

    // ── WhatsApp ─────────────────────────────────────────────────────────────

    case 'whatsapp':
        runCliScript('whatsapp.js', restArgs);
        break;

    // ── Logs ────────────────────────────────────────────────────────────────

    case 'logs':
        runCliScript('logs.js', restArgs);
        break;

    // ── Messaging ───────────────────────────────────────────────────────────

    case 'send':
        if (!restArgs[0]) {
            console.log('Usage: fonte send <message>');
            process.exit(1);
        }
        runCliScript('messaging.js', ['send', restArgs[0]]);
        break;

    // ── Agents ──────────────────────────────────────────────────────────────

    case 'agent':
        switch (restArgs[0]) {
            case 'add':
                runCliScript('agent.js', ['add']);
                break;
            case 'remove': case 'rm':
                if (!restArgs[1]) { console.log('Usage: fonte agent remove <agent_id>'); process.exit(1); }
                runCliScript('agent.js', ['remove', restArgs[1]]);
                break;
            case 'list': case 'ls':
                runCliScript('agent.js', ['list']);
                break;
            case 'show':
                if (!restArgs[1]) { console.log('Usage: fonte agent show <agent_id>'); process.exit(1); }
                runCliScript('agent.js', ['show', restArgs[1]]);
                break;
            case 'reset':
                if (!restArgs[1]) { console.log('Usage: fonte agent reset <agent_id> [...]'); process.exit(1); }
                runCliScript('agent.js', ['reset', ...restArgs.slice(1)]);
                break;
            case 'provider':
                if (!restArgs[1]) { console.log('Usage: fonte agent provider <agent_id> [provider] [--model MODEL]'); process.exit(1); }
                runCliScript('agent.js', ['provider', ...restArgs.slice(1)]);
                break;
            default:
                console.log('Usage: fonte agent {list|add|remove|show|reset|provider}');
                process.exit(1);
        }
        break;

    case 'reset':
        if (!restArgs[0]) {
            console.log('Usage: fonte reset <agent_id> [agent_id2 ...]');
            process.exit(1);
        }
        runCliScript('agent.js', ['reset', ...restArgs]);
        break;

    // ── Providers ───────────────────────────────────────────────────────────

    case 'provider':
        switch (restArgs[0]) {
            case 'list': case 'ls':
                runCliScript('agent.js', ['provider-list']);
                break;
            case 'add':
                runCliScript('agent.js', ['provider-add']);
                break;
            case 'remove': case 'rm':
                if (!restArgs[1]) { console.log('Usage: fonte provider remove <provider_id>'); process.exit(1); }
                runCliScript('agent.js', ['provider-remove', restArgs[1]]);
                break;
            case 'anthropic': case 'openai':
                runCliScript('provider.js', restArgs);
                break;
            case undefined: case '':
                runCliScript('provider.js', ['show']);
                break;
            default:
                console.log('Usage: fonte provider {anthropic|openai|list|add|remove} [--model MODEL]');
                process.exit(1);
        }
        break;

    case 'model':
        runCliScript('provider.js', ['model', restArgs[0] || '']);
        break;

    // ── Web UI ──────────────────────────────────────────────────────────────

    case 'ui': case 'web': case 'office': {
        const officeDir = path.join(REPO_ROOT, 'dashboard');
        if (!fs.existsSync(path.join(officeDir, 'node_modules'))) {
            log(BLUE, 'Installing Fonte Dashboard dependencies...');
            execSync(`cd "${officeDir}" && npm install`, { stdio: 'inherit' });
        }
        if (!fs.existsSync(path.join(officeDir, '.next/BUILD_ID'))) {
            log(BLUE, 'Building Fonte Dashboard...');
            execSync(`cd "${officeDir}" && npm run build`, { stdio: 'inherit' });
        }
        log(GREEN, 'Starting Fonte Dashboard on http://localhost:3000');
        const child = spawn('npm', ['run', 'start'], { cwd: officeDir, stdio: 'inherit' });
        child.on('exit', (code) => process.exit(code || 0));
        break;
    }

    // ── Version ─────────────────────────────────────────────────────────────

    case 'version': case '--version': case '-v': case '-V':
        runCliScript('version.js', []);
        break;

    // ── Help ────────────────────────────────────────────────────────────────

    case '--help': case '-h': case 'help':
        console.log('');
        console.log('Usage: fonte [command]');
        console.log('');
        console.log('Daemon:');
        console.log('  start                    Start Fonte (default)');
        console.log('  stop                     Stop all processes');
        console.log('  restart                  Restart Fonte');
        console.log('  status                   Show current status');
        console.log('');
        console.log('Torrents:');
        console.log('  torrent add <magnet>     Add a torrent (magnet URI or .torrent path)');
        console.log('  torrent list             List all torrents with progress');
        console.log('  torrent status <id>      Detailed torrent status');
        console.log('  torrent pause <id>       Pause a torrent');
        console.log('  torrent resume <id>      Resume a torrent');
        console.log('  torrent remove <id>      Remove torrent (--delete-files to delete data)');
        console.log('  torrent config [k] [v]   View or update torrent settings');
        console.log('');
        console.log('Watchlist:');
        console.log('  watchlist add <title>    Add to watchlist (--type movie|tv --year N --quality Q --season S03)');
        console.log('  watchlist list           List all watchlist entries');
        console.log('  watchlist remove <id>    Remove a watchlist entry');
        console.log('  watchlist check          Trigger global watchlist check');
        console.log('  watchlist search <id>    Search for a specific entry');
        console.log('');
        console.log('Subtitles:');
        console.log('  subtitle fetch <id>      Fetch subtitles for a torrent');
        console.log('  subtitle list <id>       List subtitles for a torrent');
        console.log('  subtitle translate <id> <lang>  Translate a subtitle');
        console.log('');
        console.log('AI Agents:');
        console.log('  send <msg>               Send message to AI agent');
        console.log('  agent list               List configured agents');
        console.log('  agent add                Add a new agent');
        console.log('  agent remove <id>        Remove an agent');
        console.log('  agent show <id>          Show agent config');
        console.log('  agent reset <id>         Reset agent conversation');
        console.log('');
        console.log('Channels:');
        console.log('  whatsapp                 Start WhatsApp channel (scan QR to pair)');
        console.log('');
        console.log('Other:');
        console.log('  ui                       Start web dashboard (http://localhost:3000)');
        console.log('  logs [type]              View logs (queue|daemon|all)');
        console.log('  provider [name]          Show or switch AI provider');
        console.log('  version                  Show version');
        console.log('');
        break;

    default:
        console.log(`Unknown command: ${command}`);
        console.log('Run "fonte --help" for usage information.');
        process.exit(1);
}
