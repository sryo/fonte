import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runCommandStreaming, agentStallTimeoutMs, DEFAULT_AGENT_STALL_MS } from './invoke';
import { AgentRunError, toAgentRunError } from './agent-failure';
import { writeFakeCli, loadRecording } from '../../testing/src/fake-cli';

let tmp: string;

beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fonte-stall-test-'));
});

afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(tmp, { recursive: true, force: true });
});

function shellCli(name: string, body: string): string {
    const bin = path.join(tmp, name);
    fs.writeFileSync(bin, `#!/bin/sh\n${body}\n`);
    fs.chmodSync(bin, 0o755);
    return bin;
}

function isAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function lineFeed() {
    const seen: string[] = [];
    let wake = () => {};
    return {
        onLine(line: string) {
            seen.push(line);
            wake();
        },
        async until(count: number) {
            while (seen.length < count) await new Promise<void>(resolve => { wake = resolve; });
        },
    };
}

async function waitUntil(check: () => boolean, ms: number): Promise<boolean> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
        if (check()) return true;
        await new Promise(r => setTimeout(r, 25));
    }
    return check();
}

describe('runCommandStreaming stall watchdog', () => {
    it('stops a CLI that stays silent past the timeout and reports it as stalled', async () => {
        const cli = writeFakeCli(tmp, 'claude', { hang: true });
        const started = Date.now();
        const { promise } = runCommandStreaming(cli.path, [], () => {}, tmp, undefined, undefined, { stallTimeoutMs: 300 });

        const error = await promise.catch(e => e);
        expect(error).toBeInstanceOf(AgentRunError);
        expect(error.kind).toBe('stalled');
        expect(error.message).toMatch(/no output/);
        expect(Date.now() - started).toBeLessThan(1500);
    });

    it('takes the whole process group down, including what the CLI spawned', async () => {
        const pids = path.join(tmp, 'pids');
        const bin = shellCli('silent', `sleep 30 &\necho "$$ $!" > "${pids}"\nwait`);
        const { promise } = runCommandStreaming(bin, [], () => {}, tmp, undefined, undefined, { stallTimeoutMs: 300 });

        const error = await promise.catch(e => e);
        expect(error.kind).toBe('stalled');
        const [leader, sleeper] = fs.readFileSync(pids, 'utf8').trim().split(' ').map(Number);
        expect(await waitUntil(() => !isAlive(sleeper) && !isAlive(-leader), 1000)).toBe(true);
    });

    it('restarts the countdown on every line, so steady progress is never stopped', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const cli = writeFakeCli(tmp, 'claude', { lines: ['1', '2', '3'], delayMs: 50 });
        const feed = lineFeed();
        const { promise } = runCommandStreaming(cli.path, [], feed.onLine, tmp, undefined, undefined, { stallTimeoutMs: 1000 });

        await feed.until(1);
        vi.advanceTimersByTime(700);
        await feed.until(2);
        vi.advanceTimersByTime(700);
        await feed.until(3);
        vi.advanceTimersByTime(700);
        await expect(promise).resolves.toBe('1\n2\n3\n');
    });

    it('lets a CLI that is quiet for less than the timeout finish', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const cli = writeFakeCli(tmp, 'claude', { lines: ['thinking', 'answer'], delayMs: 50 });
        const feed = lineFeed();
        const { promise } = runCommandStreaming(cli.path, [], feed.onLine, tmp, undefined, undefined, { stallTimeoutMs: 1000 });

        await feed.until(1);
        vi.advanceTimersByTime(999);
        await expect(promise).resolves.toBe('thinking\nanswer\n');
    });

    it('counts stderr as a sign of life', async () => {
        const bin = shellCli('noisy', 'for i in 1 2 3 4 5; do echo tick >&2; sleep 0.2; done\necho done');
        const { promise } = runCommandStreaming(bin, [], () => {}, tmp, undefined, undefined, { stallTimeoutMs: 700 });

        await expect(promise).resolves.toBe('done\n');
    });

    it('leaves no timer behind once the run ends', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const plain = writeFakeCli(tmp, 'plain', { lines: ['answer'] });
        await runCommandStreaming(plain.path, [], () => {}, tmp, undefined, undefined, { stallTimeoutMs: 1000 }).promise;
        expect(vi.getTimerCount()).toBe(0);

        const withResult = writeFakeCli(tmp, 'with-result', { lines: ['result'] });
        const run = runCommandStreaming(withResult.path, [], () => run.signalDone(), tmp, undefined, undefined, { stallTimeoutMs: 1000 });
        await run.promise;
        expect(vi.getTimerCount()).toBe(0);
    });

    it('marks a stall apart from a crash, even after an adapter rewraps it', async () => {
        const stalled = writeFakeCli(tmp, 'stalls', { hang: true });
        const crashed = writeFakeCli(tmp, 'crashes', { signal: 'SIGKILL' });
        const stall = await runCommandStreaming(stalled.path, [], () => {}, tmp, undefined, undefined, { stallTimeoutMs: 200 }).promise.catch(e => e);
        const crash = await runCommandStreaming(crashed.path, [], () => {}, tmp, undefined, undefined, { stallTimeoutMs: 5000 }).promise.catch(e => e);

        expect(toAgentRunError(stall).kind).toBe('stalled');
        expect(new AgentRunError(stall.message).kind).toBe('stalled');
        expect(crash.signal).toBe('SIGKILL');
        expect(toAgentRunError(crash).kind).toBe('unknown');
    });
});

describe('a stalled Claude run', () => {
    afterEach(() => { delete process.env.FONTE_AGENT_STALL_MINUTES; });

    it('fails as stalled, not with the text it printed before going quiet', async () => {
        process.env.FONTE_AGENT_STALL_MINUTES = '0.02';
        writeFakeCli(tmp, 'claude', { lines: loadRecording('claude-stream').slice(0, 3), hang: true });
        const { getAdapter } = await import('./adapters');
        const events: string[] = [];
        const error = await getAdapter('anthropic')!.invoke({
            agentId: 'stall-test', message: 'hi', workingDir: tmp, systemPrompt: '', model: '', shouldReset: true,
            envOverrides: { PATH: `${tmp}:${process.env.PATH}` },
            onEvent: text => events.push(text),
        }).catch(e => e);

        expect(events).toContain('Let me check the torrent list.');
        expect(error).toBeInstanceOf(AgentRunError);
        expect(error.kind).toBe('stalled');
        expect(error.message).toBe('claude produced no output for 1.2 seconds, so it was stopped');
    });
});

describe('agentStallTimeoutMs', () => {
    const KEY = 'FONTE_AGENT_STALL_MINUTES';
    afterEach(() => { delete process.env[KEY]; });

    it('defaults to longer than the longest a single Claude Bash call may run', () => {
        expect(agentStallTimeoutMs()).toBe(DEFAULT_AGENT_STALL_MS);
        expect(DEFAULT_AGENT_STALL_MS).toBeGreaterThan(10 * 60_000);
    });

    it('reads minutes from the environment, 0 turns it off, junk falls back', () => {
        process.env[KEY] = '30';
        expect(agentStallTimeoutMs()).toBe(30 * 60_000);
        process.env[KEY] = '0';
        expect(agentStallTimeoutMs()).toBe(0);
        process.env[KEY] = 'soon';
        expect(agentStallTimeoutMs()).toBe(DEFAULT_AGENT_STALL_MS);
        process.env[KEY] = '-5';
        expect(agentStallTimeoutMs()).toBe(DEFAULT_AGENT_STALL_MS);
    });
});
