import fs from 'fs';
import path from 'path';
import { formatBytes } from './shared.ts';

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'skip';

export interface CheckResult {
    id: string;
    status: CheckStatus;
    summary: string;
    detail?: string;
    fix?: string;
}

export type CheckOutcome = Omit<CheckResult, 'id'>;

export interface DoctorContext {
    fonteHome: string;
    homeDir: string;
    repoRoot: string;
    launchAgentsDir: string;
    platform: NodeJS.Platform;
    env: NodeJS.ProcessEnv;
    apiUrl: string;
    transmissionUrl: string;
    timeoutMs: number;
    logSizeLimitBytes: number;
    now: () => number;
    fetch: typeof fetch;
    which: (cmd: string, pathValue: string) => string | null;
    checkSqlite: (file: string) => Promise<string[]>;
}

export interface Check {
    id: string;
    title: string;
    run: (ctx: DoctorContext) => Promise<CheckOutcome>;
}

const DAEMON_LABEL = 'com.fonte.daemon';
const DASHBOARD_LABEL = 'com.fonte.dashboard';
const LAUNCHD_DEFAULT_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
const PROTECTED_FOLDERS = ['Documents', 'Desktop', 'Downloads'];
const MAIN_SCRIPT_SUFFIX = path.join('packages', 'main', 'dist', 'index.js');
const BUILD_SLACK_MS = 2000;

// ── Helpers ──────────────────────────────────────────────────────────────────

function errorText(err: unknown): string {
    if (err instanceof Error) {
        const cause = (err as { cause?: { code?: string; message?: string } }).cause;
        if (cause?.code) return cause.code;
        if (cause?.message) return cause.message;
        return err.message;
    }
    return String(err);
}

function octalMode(mode: number): string {
    return '0' + (mode & 0o777).toString(8).padStart(3, '0');
}

function formatDuration(seconds: number): string {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${m}m`;
    if (m) return `${m}m`;
    return `${Math.floor(seconds)}s`;
}

function readJson(file: string): { ok: true; value: any } | { ok: false; error: string } {
    try {
        return { ok: true, value: JSON.parse(fs.readFileSync(file, 'utf8')) };
    } catch (err) {
        return { ok: false, error: errorText(err) };
    }
}

// Resolves symlinks through the nearest existing ancestor, so a log file that
// does not exist yet still maps to the folder launchd would write it into.
function realPathLoose(p: string): string {
    let current = path.resolve(p);
    const rest: string[] = [];
    while (!fs.existsSync(current)) {
        const parent = path.dirname(current);
        if (parent === current) return path.resolve(p);
        rest.unshift(path.basename(current));
        current = parent;
    }
    return path.join(fs.realpathSync(current), ...rest);
}

function protectedFolder(ctx: DoctorContext, p: string): string | null {
    const real = realPathLoose(p);
    const home = realPathLoose(ctx.homeDir);
    for (const folder of PROTECTED_FOLDERS) {
        const dir = path.join(home, folder);
        if (real === dir || real.startsWith(dir + path.sep)) return `~/${folder}`;
    }
    return null;
}

export function whichOnPath(cmd: string, pathValue: string): string | null {
    for (const dir of pathValue.split(path.delimiter)) {
        if (!dir) continue;
        const candidate = path.join(dir, cmd);
        try {
            if (!fs.statSync(candidate).isFile()) continue;
            fs.accessSync(candidate, fs.constants.X_OK);
            return candidate;
        } catch {
            continue;
        }
    }
    return null;
}

// ── Plist ────────────────────────────────────────────────────────────────────

function decodeXml(text: string): string {
    return text
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, '\'')
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
        .replace(/&amp;/g, '&');
}

export function parsePlist(xml: string): unknown {
    const tokens = [...xml.matchAll(/<(\/?)(dict|array|key|string|integer|real|true|false|date|data)(\s*\/)?>(?:([^<]*)<\/\2>)?/g)];
    let i = 0;

    function value(): unknown {
        const token = tokens[i++];
        if (!token || token[1]) throw new Error('Unexpected plist token');
        const [, , tag, selfClosing, text] = token;
        switch (tag) {
            case 'string': case 'date': case 'data': return decodeXml(text ?? '');
            case 'integer': return parseInt(text ?? '', 10);
            case 'real': return parseFloat(text ?? '');
            case 'true': return true;
            case 'false': return false;
            case 'array': {
                const out: unknown[] = [];
                if (selfClosing) return out;
                while (tokens[i] && !(tokens[i][1] && tokens[i][2] === 'array')) out.push(value());
                i++;
                return out;
            }
            case 'dict': {
                const out: Record<string, unknown> = {};
                if (selfClosing) return out;
                while (tokens[i] && !(tokens[i][1] && tokens[i][2] === 'dict')) {
                    const key = tokens[i++];
                    if (key[2] !== 'key') throw new Error('Expected a plist key');
                    out[decodeXml(key[4] ?? '')] = value();
                }
                i++;
                return out;
            }
        }
        throw new Error(`Unsupported plist tag ${tag}`);
    }

    try {
        if (!/<plist[\s>]/.test(xml)) return null;
        return value();
    } catch {
        return null;
    }
}

interface LaunchAgent {
    file: string;
    plist: Record<string, any> | null;
}

function readLaunchAgent(ctx: DoctorContext, label: string): LaunchAgent | null {
    const file = path.join(ctx.launchAgentsDir, `${label}.plist`);
    if (!fs.existsSync(file)) return null;
    let plist: unknown = null;
    try {
        plist = parsePlist(fs.readFileSync(file, 'utf8'));
    } catch {
        plist = null;
    }
    const isDict = plist && typeof plist === 'object' && !Array.isArray(plist);
    return { file, plist: isDict ? plist as Record<string, any> : null };
}

function programArgs(plist: Record<string, any>): string[] {
    const args = Array.isArray(plist.ProgramArguments) ? plist.ProgramArguments.filter((a: unknown) => typeof a === 'string') : [];
    if (typeof plist.Program === 'string' && args[0] !== plist.Program) args.unshift(plist.Program);
    return args;
}

function daemonRepoRoot(ctx: DoctorContext): string {
    const agent = readLaunchAgent(ctx, DAEMON_LABEL);
    const script = agent?.plist ? programArgs(agent.plist).find(a => a.endsWith(MAIN_SCRIPT_SUFFIX)) : undefined;
    return script ? path.resolve(script, '../../../..') : ctx.repoRoot;
}

function cliScript(root: string): string {
    return path.join(root, 'packages', 'cli', 'bin', 'fonte.mjs');
}

// ── Probes ───────────────────────────────────────────────────────────────────

type StatusProbe =
    | { ok: true; uptime: number | null }
    | { ok: false; reason: string; detail?: string };

async function probeDaemon(ctx: DoctorContext): Promise<StatusProbe> {
    try {
        const res = await ctx.fetch(`${ctx.apiUrl}/api/status`, { signal: AbortSignal.timeout(ctx.timeoutMs) });
        if (!res.ok) {
            await res.text().catch(() => '');
            return { ok: false, reason: `Answered HTTP ${res.status} on /api/status.` };
        }
        const body = await res.json().catch(() => null) as { uptime?: unknown } | null;
        return { ok: true, uptime: typeof body?.uptime === 'number' ? body.uptime : null };
    } catch (err) {
        return { ok: false, reason: `Not reachable at ${ctx.apiUrl}.`, detail: errorText(err) };
    }
}

function newestBuildFile(root: string): { file: string; mtimeMs: number } | null {
    const packagesDir = path.join(root, 'packages');
    let newest: { file: string; mtimeMs: number } | null = null;
    let packages: string[];
    try {
        packages = fs.readdirSync(packagesDir);
    } catch {
        return null;
    }
    const walk = (dir: string) => {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name !== 'node_modules') walk(full);
            } else if (entry.isFile() && /\.(c|m)?js$/.test(entry.name)) {
                const mtimeMs = fs.statSync(full).mtimeMs;
                if (!newest || mtimeMs > newest.mtimeMs) newest = { file: full, mtimeMs };
            }
        }
    };
    for (const pkg of packages) walk(path.join(packagesDir, pkg, 'dist'));
    return newest;
}

// ── Checks ───────────────────────────────────────────────────────────────────

export const checkDaemon: Check = {
    id: 'daemon',
    title: 'Daemon',
    async run(ctx) {
        const probe = await probeDaemon(ctx);
        if (probe.ok) {
            const up = probe.uptime === null ? '' : ` Up ${formatDuration(probe.uptime)}.`;
            return { status: 'ok', summary: `Answering at ${ctx.apiUrl}.${up}` };
        }
        return {
            status: 'fail',
            summary: probe.reason,
            detail: probe.detail,
            fix: `Run fonte start. If it keeps stopping, read the logs in ${path.join(ctx.fonteHome, 'logs')}.`,
        };
    },
};

export const checkDaemonBuild: Check = {
    id: 'daemon-build',
    title: 'Daemon build',
    async run(ctx) {
        const probe = await probeDaemon(ctx);
        if (!probe.ok || probe.uptime === null) return { status: 'skip', summary: 'Daemon is not running.' };
        const root = daemonRepoRoot(ctx);
        const newest = newestBuildFile(root);
        if (!newest) return { status: 'skip', summary: `No build found in ${root}.` };
        const startedAt = ctx.now() - probe.uptime * 1000;
        if (newest.mtimeMs <= startedAt + BUILD_SLACK_MS) {
            return { status: 'ok', summary: 'Running the latest build on disk.' };
        }
        return {
            status: 'warn',
            summary: 'Started before the latest build. It is running old code.',
            detail: `${newest.file} changed ${new Date(newest.mtimeMs).toISOString()}. Daemon started ${new Date(startedAt).toISOString()}.`,
            fix: `Run node ${cliScript(root)} restart.`,
        };
    },
};

export function checkLaunchAgent(label: string): Check {
    const isDaemon = label === DAEMON_LABEL;
    return {
        id: isDaemon ? 'launchd-daemon' : label === DASHBOARD_LABEL ? 'launchd-dashboard' : `launchd-${label}`,
        title: isDaemon ? 'Daemon launch agent' : label === DASHBOARD_LABEL ? 'Dashboard launch agent' : label,
        async run(ctx) {
            if (ctx.platform !== 'darwin') return { status: 'skip', summary: 'Only used on macOS.' };
            const agent = readLaunchAgent(ctx, label);
            if (!agent) {
                return {
                    status: 'warn',
                    summary: `Not installed. ${isDaemon ? 'The daemon' : 'The dashboard'} will not start at login.`,
                    fix: 'Run ./install-app.sh from the Fonte checkout.',
                };
            }
            if (!agent.plist) {
                return {
                    status: 'warn',
                    summary: `Could not read ${agent.file}.`,
                    fix: `Check it with plutil -lint ${agent.file}.`,
                };
            }

            const plist = agent.plist;
            const args = programArgs(plist);
            const writes: [string, string][] = [];
            if (typeof plist.WorkingDirectory === 'string') writes.push(['WorkingDirectory', plist.WorkingDirectory]);
            for (const key of ['StandardOutPath', 'StandardErrorPath']) {
                if (typeof plist[key] === 'string') writes.push([key, plist[key]]);
            }

            const missing = [
                ...args.slice(1).filter(a => path.isAbsolute(a)),
                ...(typeof plist.WorkingDirectory === 'string' ? [plist.WorkingDirectory] : []),
            ].filter(p => !fs.existsSync(p));
            if (missing.length) {
                return {
                    status: 'fail',
                    summary: `Points at a missing path: ${missing.join(', ')}.`,
                    fix: 'Run ./install-app.sh from the current Fonte checkout to rewrite the launch agent.',
                };
            }

            const blockedWrites = writes
                .map(([key, p]) => ({ key, p, folder: protectedFolder(ctx, p) }))
                .filter(w => w.folder);
            if (blockedWrites.length) {
                const folders = [...new Set(blockedWrites.map(w => w.folder))].join(', ');
                return {
                    status: 'fail',
                    summary: `Writes inside ${folders}. macOS blocks launchd jobs from writing there.`,
                    detail: blockedWrites.map(w => `${w.key}: ${realPathLoose(w.p)}`).join('\n'),
                    fix: `Move these paths outside ~/Documents, ~/Desktop and ~/Downloads (for example under ${ctx.fonteHome}), then reload ${agent.file}.`,
                };
            }

            const codeInside = args
                .filter(a => path.isAbsolute(a))
                .map(a => ({ p: a, folder: protectedFolder(ctx, a) }))
                .filter(c => c.folder);
            if (codeInside.length) {
                const folders = [...new Set(codeInside.map(c => c.folder))].join(', ');
                return {
                    status: 'warn',
                    summary: `Loads code from ${folders}. Anything it writes next to that code will be blocked by macOS.`,
                    detail: codeInside.map(c => c.p).join('\n'),
                    fix: 'Run Fonte from a checkout outside ~/Documents, ~/Desktop and ~/Downloads.',
                };
            }

            return { status: 'ok', summary: 'Installed. Nothing inside ~/Documents, ~/Desktop or ~/Downloads.' };
        },
    };
}

export const checkCliPath: Check = {
    id: 'cli-path',
    title: 'CLI path',
    async run(ctx) {
        const file = path.join(ctx.fonteHome, 'cli-path');
        const expected = cliScript(daemonRepoRoot(ctx));
        const fix = `Write ${expected} into ${file}.`;
        if (!fs.existsSync(file)) {
            return { status: 'warn', summary: 'Missing. Fonte.app cannot hand links to the CLI.', fix };
        }
        const target = fs.readFileSync(file, 'utf8').trim();
        if (!target || !fs.existsSync(target)) {
            return { status: 'fail', summary: `Points at ${target || 'nothing'}, which does not exist.`, fix };
        }
        if (realPathLoose(target) !== realPathLoose(expected)) {
            return {
                status: 'warn',
                summary: `Points at ${target}, not the checkout the daemon runs.`,
                fix,
            };
        }
        return { status: 'ok', summary: `Points at ${target}.` };
    },
};

export const checkClaudeCli: Check = {
    id: 'claude-cli',
    title: 'Claude CLI',
    async run(ctx) {
        const agent = ctx.platform === 'darwin' ? readLaunchAgent(ctx, DAEMON_LABEL) : null;
        const launchdPath = agent?.plist
            ? (typeof agent.plist.EnvironmentVariables?.PATH === 'string' ? agent.plist.EnvironmentVariables.PATH : LAUNCHD_DEFAULT_PATH)
            : null;
        const shellPath = ctx.env.PATH ?? '';

        if (launchdPath === null) {
            const found = ctx.which('claude', shellPath);
            if (found) return { status: 'ok', summary: `Found at ${found} on the shell PATH.` };
            return {
                status: 'fail',
                summary: 'Not found on the shell PATH.',
                fix: 'Install Claude Code, then run claude setup-token.',
            };
        }

        const found = ctx.which('claude', launchdPath);
        if (found) return { status: 'ok', summary: `Found at ${found} on the launchd PATH.` };
        const onShell = ctx.which('claude', shellPath);
        if (onShell) {
            return {
                status: 'fail',
                summary: 'Not on the launchd PATH, so the daemon cannot run agents.',
                detail: `Found at ${onShell} on the shell PATH only. launchd PATH is ${launchdPath}.`,
                fix: `Add ${path.dirname(onShell)} to PATH in ${agent!.file}, then reload it.`,
            };
        }
        return {
            status: 'fail',
            summary: 'Not found on the launchd PATH or the shell PATH.',
            detail: `launchd PATH is ${launchdPath}.`,
            fix: 'Install Claude Code, then run claude setup-token.',
        };
    },
};

export const checkSettings: Check = {
    id: 'settings',
    title: 'Settings',
    async run(ctx) {
        const file = path.join(ctx.fonteHome, 'settings.json');
        let mode: number;
        try {
            mode = fs.statSync(file).mode;
        } catch {
            return {
                status: 'warn',
                summary: 'Missing. Fonte runs on built-in defaults.',
                fix: 'Save any setting in the dashboard to create it.',
            };
        }
        const parsed = readJson(file);
        if (!parsed.ok) {
            const backup = file + '.bak';
            return {
                status: 'fail',
                summary: 'Does not parse as JSON.',
                detail: parsed.error,
                fix: fs.existsSync(backup) ? `Fix ${file} by hand or restore ${backup}.` : `Fix ${file} by hand.`,
            };
        }
        const shown = octalMode(mode);
        if (mode & 0o007) {
            return {
                status: 'fail',
                summary: `Readable by other users (mode ${shown}). It holds API keys.`,
                fix: `Run chmod 600 ${file}.`,
            };
        }
        if (mode & 0o070) {
            return {
                status: 'warn',
                summary: `Readable by the group (mode ${shown}). It holds API keys.`,
                fix: `Run chmod 600 ${file}.`,
            };
        }
        return { status: 'ok', summary: `Parses. Mode ${shown}.` };
    },
};

export const checkWhatsappAuth: Check = {
    id: 'whatsapp-auth',
    title: 'WhatsApp auth',
    async run(ctx) {
        const dir = path.join(ctx.fonteHome, 'whatsapp-auth');
        let stat: fs.Stats;
        try {
            stat = fs.lstatSync(dir);
        } catch {
            return { status: 'skip', summary: 'Not paired.' };
        }
        if (!stat.isDirectory()) {
            return { status: 'fail', summary: `${dir} is not a folder.`, fix: 'Pair WhatsApp again from the dashboard.' };
        }
        const shown = octalMode(stat.mode);
        if (stat.mode & 0o077) {
            return {
                status: 'fail',
                summary: `Open to other users (mode ${shown}). It holds the WhatsApp session.`,
                fix: `Run chmod 700 ${dir}.`,
            };
        }
        return { status: 'ok', summary: `Mode ${shown}.` };
    },
};

export const checkDatabases: Check = {
    id: 'databases',
    title: 'Databases',
    async run(ctx) {
        let names: string[];
        try {
            names = fs.readdirSync(ctx.fonteHome).filter(n => n.endsWith('.db')).sort();
        } catch {
            names = [];
        }
        if (!names.length) return { status: 'skip', summary: 'None yet.' };

        const bad: { name: string; problems: string[] }[] = [];
        for (const name of names) {
            let problems: string[];
            try {
                problems = await ctx.checkSqlite(path.join(ctx.fonteHome, name));
            } catch (err) {
                if (err instanceof SqliteUnavailableError) {
                    return { status: 'skip', summary: 'Cannot load better-sqlite3 to check them.', detail: err.message };
                }
                problems = [errorText(err)];
            }
            if (problems.length !== 1 || problems[0] !== 'ok') bad.push({ name, problems });
        }
        if (!bad.length) return { status: 'ok', summary: `${names.join(', ')} pass integrity_check.` };
        return {
            status: 'fail',
            summary: `${bad.map(b => b.name).join(', ')} failed integrity_check.`,
            detail: bad.map(b => `${b.name}: ${b.problems.slice(0, 5).join('; ')}`).join('\n'),
            fix: 'Stop Fonte and back up the file before repairing it with sqlite3 .recover.',
        };
    },
};

export const checkLogs: Check = {
    id: 'logs',
    title: 'Logs',
    async run(ctx) {
        const dir = path.join(ctx.fonteHome, 'logs');
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return { status: 'skip', summary: 'No logs yet.' };
        }
        const files = entries
            .filter(e => e.isFile())
            .map(e => ({ file: path.join(dir, e.name), name: e.name, size: fs.statSync(path.join(dir, e.name)).size }));
        const big = files.filter(f => f.size > ctx.logSizeLimitBytes).sort((a, b) => b.size - a.size);
        const limit = formatBytes(ctx.logSizeLimitBytes);
        if (!big.length) {
            return { status: 'ok', summary: `${files.length} ${files.length === 1 ? 'file' : 'files'}, all under ${limit}.` };
        }
        return {
            status: 'warn',
            summary: `Over ${limit}: ${big.map(f => `${f.name} (${formatBytes(f.size)})`).join(', ')}.`,
            fix: `Empty them, for example: ${big.map(f => `: > ${f.file}`).join('; ')}`,
        };
    },
};

export const checkTransmission: Check = {
    id: 'transmission',
    title: 'Transmission',
    async run(ctx) {
        const where = new URL(ctx.transmissionUrl).host;
        try {
            const res = await ctx.fetch(ctx.transmissionUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{"method":"session-get"}',
                signal: AbortSignal.timeout(ctx.timeoutMs),
            });
            await res.text().catch(() => '');
            if (res.status === 409 || res.ok) return { status: 'ok', summary: `Reachable at ${where}.` };
            if (res.status === 401) {
                return {
                    status: 'warn',
                    summary: 'Asks for a username and password. Fonte connects without one.',
                    fix: 'Turn off rpc-authentication-required in Transmission\'s settings.',
                };
            }
            return { status: 'warn', summary: `Answered HTTP ${res.status} at ${where}.` };
        } catch (err) {
            return {
                status: 'fail',
                summary: `Not reachable at ${where}.`,
                detail: errorText(err),
                fix: 'Run brew services start transmission-cli.',
            };
        }
    },
};

export const checkJackett: Check = {
    id: 'jackett',
    title: 'Jackett',
    async run(ctx) {
        const file = path.join(ctx.fonteHome, 'settings.json');
        if (!fs.existsSync(file)) return { status: 'skip', summary: 'Not configured.' };
        const parsed = readJson(file);
        if (!parsed.ok) return { status: 'skip', summary: 'Settings unreadable.' };
        const url = parsed.value?.watchlist?.jackett_url;
        const key = parsed.value?.watchlist?.jackett_api_key;
        if (typeof url !== 'string' || !url) return { status: 'skip', summary: 'Not configured.' };
        if (typeof key !== 'string' || !key) {
            return {
                status: 'warn',
                summary: 'URL set but no API key.',
                fix: 'Copy the API key from the Jackett dashboard into Fonte settings.',
            };
        }
        let probe: URL;
        try {
            probe = new URL('/api/v2.0/indexers/all/results/torznab/api', url);
        } catch {
            return { status: 'fail', summary: `${url} is not a valid URL.`, fix: 'Fix the Jackett URL in Fonte settings.' };
        }
        probe.searchParams.set('apikey', key);
        probe.searchParams.set('t', 'caps');
        try {
            const res = await ctx.fetch(probe, { signal: AbortSignal.timeout(ctx.timeoutMs) });
            await res.text().catch(() => '');
            if (res.ok) return { status: 'ok', summary: `Reachable at ${url}.` };
            if (res.status === 401 || res.status === 403) {
                return {
                    status: 'fail',
                    summary: 'Rejected the API key.',
                    fix: 'Copy the API key from the Jackett dashboard into Fonte settings.',
                };
            }
            return { status: 'warn', summary: `Answered HTTP ${res.status} at ${url}.` };
        } catch (err) {
            return {
                status: 'fail',
                summary: `Not reachable at ${url}.`,
                detail: errorText(err),
                fix: 'Run brew services start jackett.',
            };
        }
    },
};

export const CHECKS: Check[] = [
    checkDaemon,
    checkDaemonBuild,
    checkLaunchAgent(DAEMON_LABEL),
    checkLaunchAgent(DASHBOARD_LABEL),
    checkCliPath,
    checkClaudeCli,
    checkSettings,
    checkWhatsappAuth,
    checkDatabases,
    checkLogs,
    checkTransmission,
    checkJackett,
];

// ── SQLite ───────────────────────────────────────────────────────────────────

export class SqliteUnavailableError extends Error {}

export async function sqliteIntegrity(file: string): Promise<string[]> {
    let Database: typeof import('better-sqlite3');
    try {
        Database = (await import('better-sqlite3')).default;
    } catch (err) {
        throw new SqliteUnavailableError(errorText(err));
    }
    let db: import('better-sqlite3').Database | undefined;
    try {
        db = new Database(file, { readonly: true, fileMustExist: true });
        const rows = db.pragma('integrity_check') as { integrity_check: string }[];
        return rows.map(r => r.integrity_check);
    } catch (err) {
        return [errorText(err)];
    } finally {
        db?.close();
    }
}

// ── Runner and report ────────────────────────────────────────────────────────

export async function runChecks(ctx: DoctorContext, checks: Check[] = CHECKS): Promise<CheckResult[]> {
    const deadlineMs = ctx.timeoutMs * 2 + 1000;
    return Promise.all(checks.map(async (check): Promise<CheckResult> => {
        let timer: NodeJS.Timeout | undefined;
        const deadline = new Promise<CheckOutcome>(resolve => {
            timer = setTimeout(() => resolve({ status: 'fail', summary: `Did not finish within ${deadlineMs} ms.` }), deadlineMs);
            timer.unref();
        });
        try {
            const outcome = await Promise.race([check.run(ctx), deadline]);
            return { id: check.id, ...outcome };
        } catch (err) {
            return { id: check.id, status: 'fail', summary: `Check crashed. ${errorText(err)}` };
        } finally {
            clearTimeout(timer);
        }
    }));
}

const COLORS: Record<CheckStatus, string> = {
    ok: '\x1b[32m',
    warn: '\x1b[33m',
    fail: '\x1b[31m',
    skip: '\x1b[2m',
};
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

export function formatReport(results: CheckResult[], opts: { color: boolean }): string {
    const titles = new Map(CHECKS.map(c => [c.id, c.title]));
    const title = (id: string) => titles.get(id) ?? id;
    const width = Math.max(...results.map(r => title(r.id).length));
    const indent = ' '.repeat(2 + 5 + 1 + width + 2);
    const paint = (code: string, text: string) => opts.color ? `${code}${text}${RESET}` : text;

    const lines: string[] = [];
    for (const r of results) {
        const status = paint(COLORS[r.status], r.status) + ' '.repeat(5 - r.status.length);
        lines.push(`  ${status} ${title(r.id).padEnd(width)}  ${r.summary}`);
        for (const line of (r.detail ?? '').split('\n').filter(Boolean)) lines.push(indent + paint(DIM, line));
        if (r.fix) lines.push(`${indent}Fix: ${r.fix}`);
    }

    const failed = results.filter(r => r.status === 'fail').length;
    const warned = results.filter(r => r.status === 'warn').length;
    const tally: string[] = [];
    if (failed) tally.push(`${failed} failed.`);
    if (warned) tally.push(`${warned} ${warned === 1 ? 'warning' : 'warnings'}.`);
    lines.push('');
    lines.push(`  ${tally.length ? tally.join(' ') : 'All checks passed.'}`);
    return lines.join('\n');
}
