import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFakeCli, loadRecording } from '../../../testing/src/fake-cli';

let tmp: string;
let bin: string;

beforeEach(() => {
    vi.resetModules();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fonte-adapter-sessions-test-'));
    bin = path.join(tmp, 'bin');
});

afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
});

async function invoke(provider: string, opts: { resumeSessionId?: string; shouldReset?: boolean } = {}) {
    const { getAdapter } = await import('./index');
    const sessions: string[] = [];
    const result = await getAdapter(provider)!.invoke({
        agentId: 'test', message: 'hi', workingDir: tmp, systemPrompt: '', model: '',
        shouldReset: opts.shouldReset ?? false,
        envOverrides: { PATH: `${bin}:${process.env.PATH}` },
        onEvent: () => {},
        onSessionId: (id) => sessions.push(id),
        resumeSessionId: opts.resumeSessionId,
    });
    return { result, sessions };
}

describe('claude adapter sessions', () => {
    it('starts a new conversation when no session is given, never continuing the directory\'s last one', async () => {
        const cli = writeFakeCli(bin, 'claude', { lines: loadRecording('claude-stream') });
        const { sessions } = await invoke('anthropic');
        const { argv } = cli.invocations()[0];
        expect(argv).not.toContain('-c');
        expect(argv).not.toContain('--continue');
        expect(argv).not.toContain('--resume');
        expect(sessions[0]).toBe('5f0c2a8e-1d7b-4c39-9a51-0b6e7f3d2c11');
    });

    it('resumes exactly the given session', async () => {
        const cli = writeFakeCli(bin, 'claude', { lines: loadRecording('claude-stream') });
        await invoke('anthropic', { resumeSessionId: 'abc-123' });
        const { argv } = cli.invocations()[0];
        expect(argv[argv.indexOf('--resume') + 1]).toBe('abc-123');
        expect(argv).not.toContain('-c');
    });
});

describe('codex adapter sessions', () => {
    it('starts a new thread when no session is given and reports its id', async () => {
        const cli = writeFakeCli(bin, 'codex', { lines: loadRecording('codex-stream') });
        const { result, sessions } = await invoke('openai');
        const { argv } = cli.invocations()[0];
        expect(argv[0]).toBe('exec');
        expect(argv).not.toContain('resume');
        expect(argv).not.toContain('--last');
        expect(argv.slice(-2)).toEqual(['--', 'hi']);
        expect(sessions).toEqual(['0199d1e2-7c4b-7a10-8f3e-5b2a9c6d4e11']);
        expect(result).toBe('One torrent is downloading: Some Show S01E01, 42% done.');
    });

    it('resumes exactly the given thread', async () => {
        const cli = writeFakeCli(bin, 'codex', { lines: loadRecording('codex-stream') });
        await invoke('openai', { resumeSessionId: '0199d1e2-7c4b-7a10-8f3e-5b2a9c6d4e11' });
        const { argv } = cli.invocations()[0];
        expect(argv.slice(0, 3)).toEqual(['exec', 'resume', '0199d1e2-7c4b-7a10-8f3e-5b2a9c6d4e11']);
        expect(argv).not.toContain('--last');
        expect(argv.slice(-2)).toEqual(['--', 'hi']);
    });
});

describe('opencode adapter sessions', () => {
    it('keeps continuing the directory\'s last conversation unless reset', async () => {
        const cli = writeFakeCli(bin, 'opencode', { lines: [{ type: 'text', part: { text: 'ok' } }] });
        await invoke('opencode');
        await invoke('opencode', { shouldReset: true });
        const [first, second] = cli.invocations();
        expect(first.argv).toContain('-c');
        expect(second.argv).not.toContain('-c');
    });
});
