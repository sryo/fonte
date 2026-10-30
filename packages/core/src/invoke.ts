import { spawn, ChildProcess, ChildProcessByStdio } from 'child_process';
import { Readable } from 'stream';
import fs from 'fs';
import path from 'path';
import { AgentConfig, CustomProvider, TeamConfig } from './types';
import { SCRIPT_DIR, resolveModel, getSettings, compactSecret } from './config';
import { log } from './logging';
import { ensureAgentDirectory, buildSystemPrompt } from './agent';
import { getAdapter } from './adapters';
import { AgentRunError, stalledRunMessage } from './agent-failure';

// ── Active process tracking ─────────────────────────────────────────────────
const activeProcesses = new Map<string, ChildProcess>();

export function getActiveAgentIds(): string[] {
    return Array.from(activeProcesses.keys());
}

// Group signal: the CLI is spawned detached as a group leader, so this
// reaches its own subprocesses (bash tools etc.), not just the CLI.
function signalGroup(child: ChildProcess, sig: NodeJS.Signals): void {
    try {
        if (child.pid) process.kill(-child.pid, sig);
        else child.kill(sig);
    } catch {
        try { child.kill(sig); } catch { /* already dead */ }
    }
}

function terminateGroup(child: ChildProcess): void {
    signalGroup(child, 'SIGTERM');
    setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) signalGroup(child, 'SIGKILL');
    }, 3000).unref();
}

export function killAgentProcess(agentId: string): boolean {
    const child = activeProcesses.get(agentId);
    if (!child) return false;
    terminateGroup(child);
    activeProcesses.delete(agentId);
    return true;
}

/**
 * Runs the CLI through /bin/sh with a watcher in its process group. The
 * watcher blocks on fd 3, whose other end only this daemon holds, so a daemon
 * that crashes or is SIGKILLed still stops the CLI instead of leaving it
 * running beside the session the next daemon resumes.
 */
export const GROUP_WATCH_SCRIPT = [
    "{ trap '' TERM; read -r _ <&3; kill -TERM 0; sleep 5; kill -KILL 0; } </dev/null >/dev/null 2>&1 &",
    'exec "$@" 3<&-',
].join('\n');

// Claude's Bash tool may run silently for up to 10 minutes, and stream-json
// prints nothing until the tool returns.
export const DEFAULT_AGENT_STALL_MS = 15 * 60_000;

/** `FONTE_AGENT_STALL_MINUTES` overrides the default; 0 turns the watchdog off. */
export function agentStallTimeoutMs(): number {
    const raw = process.env.FONTE_AGENT_STALL_MINUTES?.trim();
    if (!raw) return DEFAULT_AGENT_STALL_MS;
    const minutes = Number(raw);
    return Number.isFinite(minutes) && minutes >= 0 ? minutes * 60_000 : DEFAULT_AGENT_STALL_MS;
}

function describeSilence(ms: number): string {
    if (ms >= 60_000) {
        const minutes = Math.round(ms / 6_000) / 10;
        return `${minutes} minute${minutes === 1 ? '' : 's'}`;
    }
    const seconds = Math.round(ms / 100) / 10;
    return `${seconds} second${seconds === 1 ? '' : 's'}`;
}

export async function runCommand(command: string, args: string[], cwd?: string, envOverrides?: Record<string, string>): Promise<string> {
    return new Promise((resolve, reject) => {
        const env = { ...process.env, ...envOverrides };
        delete env.CLAUDECODE;

        const child = spawn(command, args, {
            cwd: cwd || SCRIPT_DIR,
            stdio: ['ignore', 'pipe', 'pipe'],
            env,
        });

        let stdout = '';
        let stderr = '';

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');

        child.stdout.on('data', (chunk: string) => {
            stdout += chunk;
        });

        child.stderr.on('data', (chunk: string) => {
            stderr += chunk;
        });

        child.on('error', (error) => {
            reject(error);
        });

        child.on('close', (code) => {
            if (code === 0) {
                resolve(stdout);
                return;
            }

            const errorMessage = stderr.trim() || `Command exited with code ${code}`;
            reject(new Error(errorMessage));
        });
    });
}

/**
 * Spawn a command and process stdout line-by-line as they arrive.
 * Calls `onLine` for each complete line. Returns the full stdout when done.
 *
 * The caller can call the returned `signalDone()` to indicate that all useful
 * output has been received (e.g. after a `result` JSON event). After signalDone,
 * the process gets a 30-second grace period to exit; if it doesn't, it's killed.
 * This prevents hangs when the subprocess stalls during post-result cleanup.
 *
 * A run that writes nothing to stdout or stderr for `stallTimeoutMs` has its
 * process group stopped and rejects with an `AgentRunError` of kind 'stalled'.
 */
export function runCommandStreaming(
    command: string,
    args: string[],
    onLine: (line: string) => void,
    cwd?: string,
    envOverrides?: Record<string, string>,
    agentId?: string,
    options: { stallTimeoutMs?: number } = {},
): { promise: Promise<string>; signalDone: () => void } {
    let signalDoneCallback: (() => void) | null = null;

    const promise = new Promise<string>((resolve, reject) => {
        const env = { ...process.env, ...envOverrides };
        delete env.CLAUDECODE;

        const child = spawn('/bin/sh', ['-c', GROUP_WATCH_SCRIPT, 'fonte-agent', command, ...args], {
            cwd: cwd || SCRIPT_DIR,
            stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
            env,
            // Own process group, so a user-initiated stop can signal the CLI
            // together with its subprocesses.
            detached: true,
        }) as ChildProcessByStdio<null, Readable, Readable>;
        // MCP servers and background shell jobs stay in the group after the
        // CLI exits; nothing else would ever stop them.
        child.once('exit', () => {
            if (child.pid) {
                try { process.kill(-child.pid, 'SIGKILL'); } catch { /* group already gone */ }
            }
        });

        if (agentId) {
            activeProcesses.set(agentId, child);
            child.on('close', () => {
                if (activeProcesses.get(agentId) === child) activeProcesses.delete(agentId);
            });
        }

        let stdout = '';
        let stderr = '';
        let lineBuffer = '';
        let settled = false;
        let graceTimer: ReturnType<typeof setTimeout> | null = null;
        let stallTimer: ReturnType<typeof setTimeout> | null = null;
        const stallTimeoutMs = options.stallTimeoutMs ?? agentStallTimeoutMs();

        function clearTimers() {
            if (graceTimer) clearTimeout(graceTimer);
            if (stallTimer) clearTimeout(stallTimer);
            stallTimer = null;
        }

        function armStallTimer() {
            if (settled || stallTimeoutMs <= 0) return;
            if (stallTimer) clearTimeout(stallTimer);
            stallTimer = setTimeout(() => {
                const silentFor = describeSilence(stallTimeoutMs);
                log('WARN', `Process '${command}' produced no output for ${silentFor}${agentId ? ` (agent: ${agentId})` : ''}, stopping it`);
                // Settle first: the kill's own `close` would otherwise report a plain signal.
                // `signal` tells adapters the last text printed is not an answer, as for any kill.
                const stalled = new AgentRunError(stalledRunMessage(path.basename(command), silentFor), 'stalled');
                settle(null, null, Object.assign(stalled, { signal: 'SIGTERM' as NodeJS.Signals }));
                terminateGroup(child);
            }, stallTimeoutMs);
        }

        function settle(code: number | null, signal: NodeJS.Signals | null = null, failure?: Error) {
            if (settled) return;
            settled = true;
            clearTimers();
            if (lineBuffer.trim()) onLine(lineBuffer);
            if (failure) {
                reject(failure);
            } else if (code === 0) {
                resolve(stdout);
            } else if (signal) {
                // Killed (OOM, a stop, SIGKILL): whatever it printed last is not an answer.
                reject(Object.assign(new Error(`${command} was killed by ${signal}`), { signal }));
            } else if (code === 127 && /not found/.test(stderr)) {
                reject(new Error(`${command} was not found on the daemon's PATH`));
            } else {
                reject(new Error(stderr.trim() || `Command exited with code ${code}`));
            }
        }

        signalDoneCallback = () => {
            if (settled) return;
            if (stallTimer) clearTimeout(stallTimer);
            stallTimer = null;
            graceTimer = setTimeout(() => {
                if (!settled) {
                    log('WARN', `Process '${command}' did not exit within grace period after result — killing`);
                    // Resolve successfully BEFORE killing — the kill triggers a
                    // `close` event with code 143 which would otherwise reject.
                    settle(0);
                    terminateGroup(child);
                }
            }, 30_000);
        };

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');

        armStallTimer();

        child.stdout.on('data', (chunk: string) => {
            if (stallTimer) armStallTimer();
            stdout += chunk;
            lineBuffer += chunk;
            const lines = lineBuffer.split('\n');
            // Keep the last incomplete line in the buffer
            lineBuffer = lines.pop()!;
            for (const line of lines) {
                if (line.trim()) onLine(line);
            }
        });

        child.stderr.on('data', (chunk: string) => {
            if (stallTimer) armStallTimer();
            stderr += chunk;
        });

        child.on('error', (error) => {
            if (!settled) {
                settled = true;
                clearTimers();
                reject(error);
            }
        });

        child.on('close', (code, signal) => {
            child.stdio[3]?.destroy();
            settle(code, signal);
        });
    });

    return {
        promise,
        signalDone: () => signalDoneCallback?.(),
    };
}

/**
 * Invoke a single agent with a message. Resolves the provider,
 * delegates to the matching adapter, and returns the raw response text.
 *
 * When `onEvent` is provided, streams intermediate text events as they arrive
 * from the CLI subprocess (verbose/streaming mode).
 */
export async function invokeAgent(
    agent: AgentConfig,
    agentId: string,
    message: string,
    workspacePath: string,
    _shouldReset: boolean,
    agents: Record<string, AgentConfig> = {},
    teams: Record<string, TeamConfig> = {},
    opts?: {
        onEvent?: (text: string) => void;
        onTool?: (name: string, input: unknown, toolUseId?: string) => void;
        onToolResult?: (toolUseId: string, isError: boolean) => void;
        onSessionId?: (sessionId: string) => void;
        resumeSessionId?: string;
    },
): Promise<string> {
    const agentDir = path.join(workspacePath, agentId);
    const isNewAgent = !fs.existsSync(agentDir);
    ensureAgentDirectory(agentDir);
    let shouldReset = _shouldReset;
    if (isNewAgent) {
        log('INFO', `Initialized agent directory with config files: ${agentDir}`);
        shouldReset = true;
    }

    const systemPrompt = buildSystemPrompt(agentId, agentDir, agents, teams, agent.system_prompt, agent.prompt_file);

    const workingDir = agent.working_directory
        ? (path.isAbsolute(agent.working_directory)
            ? agent.working_directory
            : path.join(workspacePath, agent.working_directory))
        : agentDir;

    const rawProvider = agent.provider || 'anthropic';

    let provider = rawProvider;
    let customProvider: CustomProvider | undefined;
    let envOverrides: Record<string, string> = {
        FONTE_AGENT_ID: agentId,
    };

    if (rawProvider.startsWith('custom:')) {
        const customId = rawProvider.slice('custom:'.length);
        const settings = getSettings();
        customProvider = settings.custom_providers?.[customId];
        if (!customProvider) {
            throw new Error(`Custom provider '${customId}' not found in settings.custom_providers`);
        }
        // Map harness back to built-in provider for adapter selection
        provider = customProvider.harness === 'codex' ? 'openai' : 'anthropic';

        if (customProvider.harness === 'claude') {
            envOverrides.ANTHROPIC_BASE_URL = customProvider.base_url;
            envOverrides.ANTHROPIC_AUTH_TOKEN = compactSecret(customProvider.api_key);
            envOverrides.ANTHROPIC_API_KEY = '';
        } else if (customProvider.harness === 'codex') {
            envOverrides.OPENAI_API_KEY = compactSecret(customProvider.api_key);
            envOverrides.OPENAI_BASE_URL = customProvider.base_url;
        }

        log('INFO', `Using custom provider '${customId}' (harness: ${customProvider.harness}, base_url: ${customProvider.base_url})`);
    } else {
        const settings = getSettings();
        const oauthToken = compactSecret(settings.models?.anthropic?.oauth_token);
        const anthropicKey = compactSecret(settings.models?.anthropic?.api_key);
        const openaiKey = compactSecret(settings.models?.openai?.api_key);
        const geminiKey = compactSecret((settings.models as any)?.gemini?.api_key);
        if (provider === 'anthropic' && oauthToken) {
            envOverrides.CLAUDE_CODE_OAUTH_TOKEN = oauthToken;
            envOverrides.ANTHROPIC_AUTH_TOKEN = '';
            envOverrides.ANTHROPIC_API_KEY = '';
        } else if (provider === 'anthropic' && anthropicKey) {
            envOverrides.ANTHROPIC_API_KEY = anthropicKey;
        } else if (provider === 'openai' && openaiKey) {
            envOverrides.OPENAI_API_KEY = openaiKey;
        } else if (provider === 'gemini' && geminiKey) {
            envOverrides.GOOGLE_API_KEY = geminiKey;
        }
    }

    // Custom providers use their own model; built-ins resolve via aliases.
    const effectiveModel = agent.model || customProvider?.model || '';
    const model = customProvider
        ? effectiveModel
        : resolveModel(effectiveModel, provider as 'anthropic' | 'openai' | 'opencode');

    const adapter = getAdapter(provider);
    if (!adapter) {
        throw new Error(`No adapter registered for provider '${provider}'`);
    }

    return adapter.invoke({
        agentId,
        message,
        workingDir,
        systemPrompt,
        model,
        shouldReset,
        envOverrides,
        onEvent: opts?.onEvent,
        onTool: opts?.onTool,
        onToolResult: opts?.onToolResult,
        onSessionId: opts?.onSessionId,
        resumeSessionId: opts?.resumeSessionId,
    });
}
