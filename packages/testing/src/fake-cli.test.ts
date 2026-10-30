import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFakeCli, loadRecording } from './fake-cli';

let tmp: string;
let bin: string;

beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fonte-fake-cli-'));
    bin = path.join(tmp, 'bin');
});

afterEach(() => {
    delete process.env.FONTE_HOME;
    fs.rmSync(tmp, { recursive: true, force: true });
});

function run(file: string, args: string[], cwd = tmp): Promise<{ stdout: string; stderr: string; code: number | null; signal: NodeJS.Signals | null }> {
    return new Promise((resolve, reject) => {
        const child = spawn(file, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', d => { stdout += d; });
        child.stderr.on('data', d => { stderr += d; });
        child.on('error', reject);
        child.on('close', (code, signal) => resolve({ stdout, stderr, code, signal }));
    });
}

describe('writeFakeCli', () => {
    it('replays its lines, records argv and cwd, and exits with the given code', async () => {
        const cli = writeFakeCli(bin, 'claude', {
            lines: [{ type: 'system', subtype: 'init', session_id: 's1' }, 'not json'],
            stderr: 'warning: something\n',
            exitCode: 3,
        });

        const out = await run(cli.path, ['-p', 'hello world', '--verbose']);

        expect(out.stdout.trim().split('\n')).toEqual(['{"type":"system","subtype":"init","session_id":"s1"}', 'not json']);
        expect(out.stderr).toBe('warning: something\n');
        expect(out.code).toBe(3);
        expect(cli.invocations()).toEqual([{ argv: ['-p', 'hello world', '--verbose'], cwd: fs.realpathSync(tmp) }]);
    });

    it('records every invocation in order', async () => {
        const cli = writeFakeCli(bin, 'codex', { lines: [] });

        await run(cli.path, ['exec', 'one']);
        await run(cli.path, ['exec', 'two']);

        expect(cli.invocations().map(i => i.argv)).toEqual([['exec', 'one'], ['exec', 'two']]);
    });

    it('can die from a signal after its output', async () => {
        const cli = writeFakeCli(bin, 'claude', { lines: [{ type: 'assistant' }], signal: 'SIGTERM' });

        const out = await run(cli.path, []);

        expect(out.stdout.trim()).toBe('{"type":"assistant"}');
        expect(out.signal).toBe('SIGTERM');
    });

    it('waits between lines when asked', async () => {
        const cli = writeFakeCli(bin, 'claude', { lines: ['a', 'b', 'c'], delayMs: 40 });

        const started = Date.now();
        const out = await run(cli.path, []);

        expect(out.stdout).toBe('a\nb\nc\n');
        expect(Date.now() - started).toBeGreaterThanOrEqual(80);
    });

    it('replays a recording fixture', async () => {
        const recording = loadRecording('claude-stream');
        const cli = writeFakeCli(bin, 'claude', { lines: recording });

        const out = await run(cli.path, []);

        expect(out.stdout.trim().split('\n')).toEqual(recording);
        expect(recording.every(line => JSON.parse(line))).toBe(true);
    });
});

describe('recordings against the real adapters', () => {
    async function invokeAdapter(provider: string) {
        process.env.FONTE_HOME = tmp;
        fs.mkdirSync(path.join(tmp, 'logs'), { recursive: true });
        vi.resetModules();
        const { getAdapter } = await import('../../core/src/adapters/index');
        const events: string[] = [];
        const tools: string[] = [];
        const sessions: string[] = [];
        const result = await getAdapter(provider)!.invoke({
            agentId: 'fake-cli-test', message: 'what is downloading?', workingDir: tmp, systemPrompt: '', model: '', shouldReset: true,
            envOverrides: { PATH: `${bin}:${process.env.PATH}` },
            onEvent: text => events.push(text),
            onTool: name => tools.push(name),
            onSessionId: id => sessions.push(id),
        });
        return { result, events, tools, sessions };
    }

    it('the Claude recording parses into a session, a tool call and a final answer', async () => {
        const cli = writeFakeCli(bin, 'claude', { lines: loadRecording('claude-stream') });

        const { result, events, tools, sessions } = await invokeAdapter('anthropic');

        expect(result).toBe('One torrent is downloading: Some Show S01E01, 42% done.');
        expect(tools).toEqual(['Bash']);
        expect(events).toEqual(['Let me check the torrent list.', 'One torrent is downloading: Some Show S01E01, 42% done.']);
        expect(new Set(sessions)).toEqual(new Set(['5f0c2a8e-1d7b-4c39-9a51-0b6e7f3d2c11']));
        expect(cli.invocations()[0].argv).toEqual(expect.arrayContaining(['--output-format', 'stream-json', '-p', 'what is downloading?']));
    });

    it('the Codex recording parses into its final agent message', async () => {
        const cli = writeFakeCli(bin, 'codex', { lines: loadRecording('codex-stream') });

        const { result, events } = await invokeAdapter('openai');

        expect(result).toBe('One torrent is downloading: Some Show S01E01, 42% done.');
        expect(events).toEqual(['One torrent is downloading: Some Show S01E01, 42% done.']);
        expect(cli.invocations()[0].argv).toEqual(['exec', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '--json', 'what is downloading?']);
    });
});
