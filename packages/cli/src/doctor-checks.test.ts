import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import {
    type Check,
    type CheckResult,
    type DoctorContext,
    CHECKS,
    checkSettings,
    checkWhatsappAuth,
    checkDatabases,
    checkDaemon,
    checkDaemonBuild,
    checkLaunchAgent,
    checkCliPath,
    checkClaudeCli,
    checkTransmission,
    checkJackett,
    checkLogs,
    formatReport,
    parsePlist,
    runChecks,
    sqliteIntegrity,
} from './doctor-checks.ts';

let root: string;
let home: string;
let fonteHome: string;
let repo: string;
let agentsDir: string;
const servers: http.Server[] = [];

const NOW = Date.parse('2026-10-30T12:00:00Z');

function makeCtx(overrides: Partial<DoctorContext> = {}): DoctorContext {
    return {
        fonteHome,
        homeDir: home,
        repoRoot: repo,
        launchAgentsDir: agentsDir,
        platform: 'darwin',
        env: { PATH: '/shell/bin' },
        apiUrl: 'http://127.0.0.1:1',
        transmissionUrl: 'http://127.0.0.1:1/transmission/rpc',
        timeoutMs: 2000,
        logSizeLimitBytes: 1024,
        now: () => NOW,
        fetch: globalThis.fetch,
        which: () => null,
        checkSqlite: async () => ['ok'],
        ...overrides,
    };
}

async function serve(handler: http.RequestListener): Promise<string> {
    const server = http.createServer(handler);
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
}

function writeFile(file: string, content: string, mode?: number): string {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    if (mode !== undefined) fs.chmodSync(file, mode);
    return file;
}

function plistXml(dict: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${dict}
</dict>
</plist>
`;
}

function writeDaemonPlist(opts: { script?: string; pathEnv?: string | null; stdout?: string } = {}): string {
    const script = opts.script ?? path.join(repo, 'packages/main/dist/index.js');
    const envEntry = opts.pathEnv === null ? '' : `
        <key>PATH</key>
        <string>${opts.pathEnv ?? '/launchd/bin:/usr/bin:/bin'}</string>`;
    return writeFile(path.join(agentsDir, 'com.fonte.daemon.plist'), plistXml(`
    <key>Label</key>
    <string>com.fonte.daemon</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/node</string>
        <string>${script}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${opts.stdout ?? path.join(fonteHome, 'logs/launchd.log')}</string>
    <key>EnvironmentVariables</key>
    <dict>${envEntry}
        <key>HOME</key>
        <string>${home}</string>
    </dict>`));
}

function writeDashboardPlist(workingDir: string): string {
    return writeFile(path.join(agentsDir, 'com.fonte.dashboard.plist'), plistXml(`
    <key>Label</key>
    <string>com.fonte.dashboard</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/npm</string>
        <string>run</string>
        <string>start</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${workingDir}</string>`));
}

function snapshot(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
        const full = path.join(entry.parentPath, entry.name);
        const stat = fs.statSync(full);
        out.push(`${path.relative(dir, full)} ${stat.mode} ${stat.size} ${stat.mtimeMs}`);
    }
    return out.sort();
}

beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fonte-doctor-')));
    home = path.join(root, 'home');
    fonteHome = path.join(home, '.fonte');
    repo = path.join(home, 'src/fonte');
    agentsDir = path.join(home, 'Library/LaunchAgents');
    fs.mkdirSync(fonteHome, { recursive: true });
    fs.mkdirSync(repo, { recursive: true });
});

afterEach(async () => {
    await Promise.all(servers.splice(0).map(s => new Promise(resolve => {
        s.closeAllConnections();
        s.close(resolve);
    })));
    fs.rmSync(root, { recursive: true, force: true });
});

describe('parsePlist', () => {
    it('reads strings, booleans, integers, arrays and nested dicts', () => {
        const value = parsePlist(plistXml(`
    <key>Label</key>
    <string>com.fonte.daemon</string>
    <key>Args</key>
    <array><string>a &amp; b</string><string>c</string></array>
    <key>KeepAlive</key>
    <true/>
    <key>Disabled</key>
    <false/>
    <key>Nice</key>
    <integer>5</integer>
    <key>Env</key>
    <dict><key>PATH</key><string>/x:/y</string></dict>`));

        expect(value).toEqual({
            Label: 'com.fonte.daemon',
            Args: ['a & b', 'c'],
            KeepAlive: true,
            Disabled: false,
            Nice: 5,
            Env: { PATH: '/x:/y' },
        });
    });

    it('returns null for something that is not an XML plist', () => {
        expect(parsePlist('bplist00\u0000\u0001')).toBeNull();
    });
});

describe('checkSettings', () => {
    const file = () => path.join(fonteHome, 'settings.json');

    it('passes for valid JSON with mode 0600', async () => {
        writeFile(file(), '{"agents":{}}', 0o600);
        const result = await checkSettings.run(makeCtx());
        expect(result.status).toBe('ok');
        expect(result.summary).toContain('0600');
    });

    it('fails when the file does not parse', async () => {
        writeFile(file(), '{"agents": {', 0o600);
        const result = await checkSettings.run(makeCtx());
        expect(result.status).toBe('fail');
        expect(result.summary).toMatch(/does not parse/i);
        expect(result.fix).toBeDefined();
    });

    it('fails when other users can read it', async () => {
        writeFile(file(), '{}', 0o644);
        const result = await checkSettings.run(makeCtx());
        expect(result.status).toBe('fail');
        expect(result.summary).toContain('0644');
        expect(result.fix).toContain(`chmod 600 ${file()}`);
    });

    it('warns when only the group can read it', async () => {
        writeFile(file(), '{}', 0o640);
        const result = await checkSettings.run(makeCtx());
        expect(result.status).toBe('warn');
        expect(result.fix).toContain('chmod 600');
    });

    it('warns when the file is missing', async () => {
        const result = await checkSettings.run(makeCtx());
        expect(result.status).toBe('warn');
    });
});

describe('checkWhatsappAuth', () => {
    const dir = () => path.join(fonteHome, 'whatsapp-auth');

    it('skips when WhatsApp was never paired', async () => {
        expect((await checkWhatsappAuth.run(makeCtx())).status).toBe('skip');
    });

    it('passes for mode 0700', async () => {
        fs.mkdirSync(dir(), { mode: 0o700 });
        fs.chmodSync(dir(), 0o700);
        expect((await checkWhatsappAuth.run(makeCtx())).status).toBe('ok');
    });

    it('fails when other users can list it', async () => {
        fs.mkdirSync(dir());
        fs.chmodSync(dir(), 0o755);
        const result = await checkWhatsappAuth.run(makeCtx());
        expect(result.status).toBe('fail');
        expect(result.summary).toContain('0755');
        expect(result.fix).toContain(`chmod 700 ${dir()}`);
    });
});

describe('checkDatabases', () => {
    it('skips when there are no databases yet', async () => {
        expect((await checkDatabases.run(makeCtx())).status).toBe('skip');
    });

    it('passes when every database reports ok', async () => {
        writeFile(path.join(fonteHome, 'fonte.db'), '');
        writeFile(path.join(fonteHome, 'torrents.db'), '');
        const seen: string[] = [];
        const result = await checkDatabases.run(makeCtx({
            checkSqlite: async (file) => { seen.push(path.basename(file)); return ['ok']; },
        }));
        expect(result.status).toBe('ok');
        expect(seen.sort()).toEqual(['fonte.db', 'torrents.db']);
        expect(result.summary).toContain('fonte.db');
    });

    it('fails and names the database that has problems', async () => {
        writeFile(path.join(fonteHome, 'fonte.db'), '');
        writeFile(path.join(fonteHome, 'torrents.db'), '');
        const result = await checkDatabases.run(makeCtx({
            checkSqlite: async (file) => file.endsWith('torrents.db') ? ['row 3 missing from index'] : ['ok'],
        }));
        expect(result.status).toBe('fail');
        expect(result.summary).toContain('torrents.db');
        expect(result.summary).not.toContain('fonte.db');
        expect(result.detail).toContain('row 3 missing from index');
    });
});

describe('sqliteIntegrity', () => {
    it('reports ok for a healthy WAL database while a writer holds it open', async () => {
        const file = path.join(fonteHome, 'fonte.db');
        const writer = new Database(file);
        writer.pragma('journal_mode = WAL');
        writer.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT); INSERT INTO t (v) VALUES (\'a\');');
        try {
            expect(await sqliteIntegrity(file)).toEqual(['ok']);
        } finally {
            writer.close();
        }
    });

    it('reports an error for a file that is not a database', async () => {
        const file = writeFile(path.join(fonteHome, 'broken.db'), 'this is not sqlite at all, just text '.repeat(200));
        const problems = await sqliteIntegrity(file);
        expect(problems).not.toEqual(['ok']);
        expect(problems.join(' ')).toMatch(/not a database|malformed/i);
    });

    it('never creates a database that does not exist', async () => {
        const file = path.join(fonteHome, 'absent.db');
        const problems = await sqliteIntegrity(file);
        expect(problems).not.toEqual(['ok']);
        expect(fs.existsSync(file)).toBe(false);
    });
});

describe('checkDaemon', () => {
    it('passes when /api/status answers', async () => {
        const url = await serve((req, res) => {
            expect(req.url).toBe('/api/status');
            json(res, 200, { ok: true, uptime: 3725, server: { running: true, port: 3999 } });
        });
        const result = await checkDaemon.run(makeCtx({ apiUrl: url }));
        expect(result.status).toBe('ok');
        expect(result.summary).toContain('1h 2m');
    });

    it('fails when nothing is listening', async () => {
        const url = await serve(() => {});
        await new Promise(resolve => servers.pop()!.close(resolve));
        const result = await checkDaemon.run(makeCtx({ apiUrl: url }));
        expect(result.status).toBe('fail');
        expect(result.summary).toContain(url);
        expect(result.fix).toBeDefined();
    });

    it('fails when the status endpoint errors', async () => {
        const url = await serve((_req, res) => json(res, 500, { ok: false, error: 'boom' }));
        const result = await checkDaemon.run(makeCtx({ apiUrl: url }));
        expect(result.status).toBe('fail');
        expect(result.summary).toContain('500');
    });

    it('gives up after the timeout instead of hanging', async () => {
        const url = await serve(() => {});
        const started = Date.now();
        const result = await checkDaemon.run(makeCtx({ apiUrl: url, timeoutMs: 100 }));
        expect(result.status).toBe('fail');
        expect(Date.now() - started).toBeLessThan(1500);
    });
});

describe('checkDaemonBuild', () => {
    const distFile = () => path.join(repo, 'packages/server/dist/routes/torrents.js');

    function buildAt(ms: number): void {
        writeFile(path.join(repo, 'packages/main/dist/index.js'), '');
        writeFile(distFile(), '');
        fs.utimesSync(path.join(repo, 'packages/main/dist/index.js'), (ms - 60_000) / 1000, (ms - 60_000) / 1000);
        fs.utimesSync(distFile(), ms / 1000, ms / 1000);
    }

    it('skips when the daemon is not running', async () => {
        buildAt(NOW - 3600_000);
        expect((await checkDaemonBuild.run(makeCtx())).status).toBe('skip');
    });

    it('passes when the daemon started after the newest build', async () => {
        buildAt(NOW - 3600_000);
        const url = await serve((_req, res) => json(res, 200, { ok: true, uptime: 600 }));
        const result = await checkDaemonBuild.run(makeCtx({ apiUrl: url }));
        expect(result.status).toBe('ok');
    });

    it('warns when dist on disk is newer than the running daemon', async () => {
        buildAt(NOW - 60_000);
        const url = await serve((_req, res) => json(res, 200, { ok: true, uptime: 3600 }));
        const result = await checkDaemonBuild.run(makeCtx({ apiUrl: url }));
        expect(result.status).toBe('warn');
        expect(result.detail).toContain('packages/server/dist/routes/torrents.js');
        expect(result.fix).toContain('restart');
    });

    it('reads the checkout from the daemon launch agent rather than its own repo', async () => {
        const other = path.join(home, 'elsewhere');
        writeFile(path.join(other, 'packages/main/dist/index.js'), '');
        fs.utimesSync(path.join(other, 'packages/main/dist/index.js'), (NOW - 10_000) / 1000, (NOW - 10_000) / 1000);
        buildAt(NOW - 3600_000);
        writeDaemonPlist({ script: path.join(other, 'packages/main/dist/index.js') });
        const url = await serve((_req, res) => json(res, 200, { ok: true, uptime: 600 }));
        const result = await checkDaemonBuild.run(makeCtx({ apiUrl: url }));
        expect(result.status).toBe('warn');
        expect(result.detail).toContain(other);
    });
});

describe('checkLaunchAgent', () => {
    const daemon = checkLaunchAgent('com.fonte.daemon');
    const dashboard = checkLaunchAgent('com.fonte.dashboard');

    it('skips off macOS', async () => {
        expect((await daemon.run(makeCtx({ platform: 'linux' }))).status).toBe('skip');
    });

    it('warns when the launch agent is not installed', async () => {
        const result = await daemon.run(makeCtx());
        expect(result.status).toBe('warn');
        expect(result.fix).toContain('install-app.sh');
    });

    it('passes when the job lives outside the protected folders', async () => {
        writeFile(path.join(repo, 'packages/main/dist/index.js'), '');
        writeDaemonPlist();
        const result = await daemon.run(makeCtx());
        expect(result.status).toBe('ok');
    });

    it('fails when the dashboard works inside ~/Documents', async () => {
        const dir = path.join(home, 'Documents/fonte/dashboard');
        fs.mkdirSync(dir, { recursive: true });
        writeDashboardPlist(dir);
        const result = await dashboard.run(makeCtx());
        expect(result.status).toBe('fail');
        expect(result.summary).toContain('~/Documents');
    });

    it('fails when the working directory is a symlink into ~/Documents', async () => {
        const real = path.join(home, 'Documents/fonte/dashboard');
        fs.mkdirSync(real, { recursive: true });
        const link = path.join(fonteHome, 'dashboard-app');
        fs.symlinkSync(real, link);
        writeDashboardPlist(link);
        const result = await dashboard.run(makeCtx());
        expect(result.status).toBe('fail');
        expect(result.detail).toContain(real);
    });

    it('fails when logs go to ~/Desktop', async () => {
        writeFile(path.join(repo, 'packages/main/dist/index.js'), '');
        writeDaemonPlist({ stdout: path.join(home, 'Desktop/fonte.log') });
        const result = await daemon.run(makeCtx());
        expect(result.status).toBe('fail');
        expect(result.summary).toContain('~/Desktop');
    });

    it('warns when the daemon loads its code from ~/Documents', async () => {
        const script = writeFile(path.join(home, 'Documents/fonte/packages/main/dist/index.js'), '');
        writeDaemonPlist({ script });
        const result = await daemon.run(makeCtx());
        expect(result.status).toBe('warn');
        expect(result.summary).toContain('~/Documents');
    });

    it('fails when the daemon script does not exist', async () => {
        writeDaemonPlist({ script: path.join(home, 'gone/packages/main/dist/index.js') });
        const result = await daemon.run(makeCtx());
        expect(result.status).toBe('fail');
        expect(result.summary).toMatch(/missing/i);
    });

    it('warns when the plist cannot be read', async () => {
        writeFile(path.join(agentsDir, 'com.fonte.daemon.plist'), 'bplist00garbage');
        expect((await daemon.run(makeCtx())).status).toBe('warn');
    });
});

describe('checkCliPath', () => {
    const cliFile = () => path.join(fonteHome, 'cli-path');
    const cli = (dir: string) => path.join(dir, 'packages/cli/bin/fonte.mjs');

    it('passes when it points at the checkout the daemon runs', async () => {
        writeFile(cli(repo), '');
        writeFile(path.join(repo, 'packages/main/dist/index.js'), '');
        writeDaemonPlist();
        writeFile(cliFile(), cli(repo) + '\n');
        expect((await checkCliPath.run(makeCtx())).status).toBe('ok');
    });

    it('warns when the file is missing', async () => {
        const result = await checkCliPath.run(makeCtx());
        expect(result.status).toBe('warn');
        expect(result.fix).toContain(cli(repo));
    });

    it('fails when it points at a checkout that no longer exists', async () => {
        writeFile(cliFile(), cli(path.join(home, 'Documents/aitorrent')) + '\n');
        const result = await checkCliPath.run(makeCtx());
        expect(result.status).toBe('fail');
        expect(result.summary).toContain('aitorrent');
    });

    it('warns when it points at a different checkout than the daemon', async () => {
        const other = path.join(home, 'old-fonte');
        writeFile(cli(other), '');
        writeFile(cli(repo), '');
        writeFile(path.join(repo, 'packages/main/dist/index.js'), '');
        writeDaemonPlist();
        writeFile(cliFile(), cli(other));
        const result = await checkCliPath.run(makeCtx());
        expect(result.status).toBe('warn');
        expect(result.fix).toContain(cli(repo));
    });
});

describe('checkClaudeCli', () => {
    function whichIn(found: Record<string, string>) {
        return (cmd: string, pathValue: string) => {
            for (const dir of pathValue.split(':')) {
                if (found[dir] === cmd) return path.join(dir, cmd);
            }
            return null;
        };
    }

    it('passes when claude is on the launchd PATH', async () => {
        writeDaemonPlist({ pathEnv: '/launchd/bin:/usr/bin' });
        const result = await checkClaudeCli.run(makeCtx({ which: whichIn({ '/launchd/bin': 'claude' }) }));
        expect(result.status).toBe('ok');
        expect(result.summary).toContain('/launchd/bin/claude');
    });

    it('fails when claude is only on the shell PATH', async () => {
        writeDaemonPlist({ pathEnv: '/launchd/bin:/usr/bin' });
        const result = await checkClaudeCli.run(makeCtx({
            env: { PATH: '/Users/me/.local/bin:/usr/bin' },
            which: whichIn({ '/Users/me/.local/bin': 'claude' }),
        }));
        expect(result.status).toBe('fail');
        expect(result.summary).toMatch(/launchd PATH/);
        expect(result.detail).toContain('/Users/me/.local/bin/claude');
        expect(result.fix).toContain('/Users/me/.local/bin');
    });

    it('fails when claude is nowhere', async () => {
        writeDaemonPlist();
        const result = await checkClaudeCli.run(makeCtx());
        expect(result.status).toBe('fail');
        expect(result.fix).toBeDefined();
    });

    it('uses the launchd default PATH when the plist sets none', async () => {
        writeDaemonPlist({ pathEnv: null });
        const seen: string[] = [];
        await checkClaudeCli.run(makeCtx({ which: (_cmd, p) => { seen.push(p); return null; } }));
        expect(seen[0]).toBe('/usr/bin:/bin:/usr/sbin:/sbin');
    });

    it('falls back to the shell PATH without a launch agent', async () => {
        const result = await checkClaudeCli.run(makeCtx({ which: whichIn({ '/shell/bin': 'claude' }) }));
        expect(result.status).toBe('ok');
        expect(result.summary).toMatch(/shell PATH/);
    });
});

describe('checkTransmission', () => {
    it('passes on the 409 session handshake', async () => {
        const url = await serve((req, res) => {
            expect(req.method).toBe('POST');
            res.writeHead(409, { 'X-Transmission-Session-Id': 'abc' });
            res.end();
        });
        const result = await checkTransmission.run(makeCtx({ transmissionUrl: `${url}/transmission/rpc` }));
        expect(result.status).toBe('ok');
    });

    it('warns when Transmission wants a password', async () => {
        const url = await serve((_req, res) => { res.writeHead(401); res.end(); });
        const result = await checkTransmission.run(makeCtx({ transmissionUrl: `${url}/transmission/rpc` }));
        expect(result.status).toBe('warn');
    });

    it('fails when Transmission is not reachable', async () => {
        const result = await checkTransmission.run(makeCtx());
        expect(result.status).toBe('fail');
        expect(result.fix).toContain('transmission');
    });
});

describe('checkJackett', () => {
    function settings(watchlist: Record<string, unknown>): void {
        writeFile(path.join(fonteHome, 'settings.json'), JSON.stringify({ watchlist }), 0o600);
    }

    it('skips when Jackett is not configured', async () => {
        settings({});
        expect((await checkJackett.run(makeCtx())).status).toBe('skip');
    });

    it('reports not configured when there is no settings file', async () => {
        const result = await checkJackett.run(makeCtx());
        expect(result).toEqual({ status: 'skip', summary: 'Not configured.' });
    });

    it('skips when settings cannot be read', async () => {
        writeFile(path.join(fonteHome, 'settings.json'), '{', 0o600);
        expect((await checkJackett.run(makeCtx())).status).toBe('skip');
    });

    it('passes when Jackett answers with the configured key', async () => {
        let query: URLSearchParams | undefined;
        const url = await serve((req, res) => {
            query = new URL(req.url!, 'http://x').searchParams;
            res.writeHead(200, { 'Content-Type': 'application/xml' });
            res.end('<caps/>');
        });
        settings({ jackett_url: url, jackett_api_key: 'secret-key' });
        const result = await checkJackett.run(makeCtx());
        expect(result.status).toBe('ok');
        expect(query?.get('apikey')).toBe('secret-key');
        expect(JSON.stringify(result)).not.toContain('secret-key');
    });

    it('fails when Jackett rejects the key', async () => {
        const url = await serve((_req, res) => { res.writeHead(401); res.end(); });
        settings({ jackett_url: url, jackett_api_key: 'wrong' });
        const result = await checkJackett.run(makeCtx());
        expect(result.status).toBe('fail');
        expect(result.summary).toMatch(/API key/);
    });

    it('fails when Jackett is down', async () => {
        settings({ jackett_url: 'http://127.0.0.1:1', jackett_api_key: 'k' });
        const result = await checkJackett.run(makeCtx());
        expect(result.status).toBe('fail');
        expect(result.fix).toContain('jackett');
    });

    it('warns when a URL is set without a key', async () => {
        settings({ jackett_url: 'http://127.0.0.1:1' });
        expect((await checkJackett.run(makeCtx())).status).toBe('warn');
    });
});

describe('checkLogs', () => {
    it('skips when there is no logs folder', async () => {
        expect((await checkLogs.run(makeCtx())).status).toBe('skip');
    });

    it('passes when every log is under the limit', async () => {
        writeFile(path.join(fonteHome, 'logs/queue.log'), 'x'.repeat(100));
        expect((await checkLogs.run(makeCtx())).status).toBe('ok');
    });

    it('warns and names the logs over the limit', async () => {
        writeFile(path.join(fonteHome, 'logs/queue.log'), 'x'.repeat(100));
        const big = writeFile(path.join(fonteHome, 'logs/launchd.err'), '');
        fs.truncateSync(big, 5000);
        const result = await checkLogs.run(makeCtx());
        expect(result.status).toBe('warn');
        expect(result.summary).toContain('launchd.err');
        expect(result.summary).not.toContain('queue.log');
        expect(result.fix).toContain(big);
    });
});

describe('runChecks', () => {
    it('runs every check and keeps their order', async () => {
        const checks: Check[] = [
            { id: 'a', title: 'A', run: async () => { await new Promise(r => setTimeout(r, 20)); return { status: 'ok', summary: 'A.' }; } },
            { id: 'b', title: 'B', run: async () => ({ status: 'warn', summary: 'B.' }) },
        ];
        const results = await runChecks(makeCtx(), checks);
        expect(results.map(r => [r.id, r.status])).toEqual([['a', 'ok'], ['b', 'warn']]);
    });

    it('turns a thrown check into a fail instead of crashing', async () => {
        const checks: Check[] = [
            { id: 'boom', title: 'Boom', run: async () => { throw new Error('kaput'); } },
        ];
        const [result] = await runChecks(makeCtx(), checks);
        expect(result).toMatchObject({ id: 'boom', status: 'fail' });
        expect(result.summary).toContain('kaput');
    });

    it('fails a check that runs past its deadline', async () => {
        const checks: Check[] = [
            { id: 'slow', title: 'Slow', run: () => new Promise(() => {}) },
        ];
        const [result] = await runChecks(makeCtx({ timeoutMs: 50 }), checks);
        expect(result).toMatchObject({ id: 'slow', status: 'fail' });
        expect(result.summary).toMatch(/did not finish/i);
    });

    it('leaves FONTE_HOME untouched when every check runs against a populated home', async () => {
        writeFile(path.join(fonteHome, 'settings.json'), '{"watchlist":{"jackett_url":"http://127.0.0.1:1","jackett_api_key":"k"}}', 0o644);
        fs.mkdirSync(path.join(fonteHome, 'whatsapp-auth'));
        fs.chmodSync(path.join(fonteHome, 'whatsapp-auth'), 0o755);
        const db = new Database(path.join(fonteHome, 'fonte.db'));
        db.exec('CREATE TABLE t (id INTEGER)');
        db.close();
        writeFile(path.join(fonteHome, 'logs/queue.log'), 'x'.repeat(2000));
        writeFile(path.join(fonteHome, 'cli-path'), '/nowhere/fonte.mjs');
        const before = snapshot(fonteHome);

        const results = await runChecks(makeCtx({ checkSqlite: sqliteIntegrity, timeoutMs: 500 }), CHECKS);

        expect(results.length).toBe(CHECKS.length);
        expect(snapshot(fonteHome)).toEqual(before);
    });
});

describe('formatReport', () => {
    const results: CheckResult[] = [
        { id: 'settings', status: 'ok', summary: 'Parses. Mode 0600.' },
        { id: 'daemon', status: 'fail', summary: 'Not reachable.', fix: 'Run fonte start.' },
        { id: 'jackett', status: 'skip', summary: 'Not configured.' },
        { id: 'logs', status: 'warn', summary: 'Large.', detail: 'queue.log 2 GB' },
    ];

    it('prints one line per check, its fix underneath, and a tally', () => {
        const text = formatReport(results, { color: false });
        const lines = text.split('\n');
        expect(lines.find(l => l.includes('Parses.'))).toMatch(/^\s*ok\s+Settings\s+Parses\. Mode 0600\.$/);
        expect(lines.find(l => l.includes('Not reachable.'))).toMatch(/^\s*fail\s+Daemon\s+/);
        expect(text).toContain('Run fonte start.');
        expect(text).toContain('queue.log 2 GB');
        expect(text).toMatch(/1 failed\. 1 warning\./);
        expect(text).not.toMatch(/\u2014|\u00b7/);
        expect(text).not.toContain('\x1b[');
    });

    it('says all clear when nothing failed or warned', () => {
        const text = formatReport([results[0], results[2]], { color: false });
        expect(text).toMatch(/All checks passed\./);
    });

    it('colors the status word when asked', () => {
        expect(formatReport(results, { color: true })).toContain('\x1b[31mfail');
    });
});
