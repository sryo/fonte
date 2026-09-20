import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The adapter shells out to `claude`; a fake one on PATH replays a stream and
// exits how we tell it to. FONTE_HOME keeps the logger out of the real home.
let tmp: string;
let fakeBin: string;

beforeEach(() => {
    vi.resetModules();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fonte-claude-test-'));
    fakeBin = path.join(tmp, 'bin');
    fs.mkdirSync(path.join(tmp, 'logs'), { recursive: true });
    fs.mkdirSync(fakeBin);
    process.env.FONTE_HOME = tmp;
});

afterEach(() => {
    delete process.env.FONTE_HOME;
    fs.rmSync(tmp, { recursive: true, force: true });
});

function fakeClaude(lines: object[], exitCode: number): void {
    const script = ['#!/bin/sh', ...lines.map(l => `echo '${JSON.stringify(l)}'`), `exit ${exitCode}`].join('\n');
    const bin = path.join(fakeBin, 'claude');
    fs.writeFileSync(bin, script + '\n');
    fs.chmodSync(bin, 0o755);
}

async function invoke(): Promise<{ result: string | null; error: unknown; events: string[] }> {
    // Through the registry: importing ./claude first would hit the
    // invoke ↔ adapters import cycle before claudeAdapter exists.
    const { getAdapter } = await import('./index');
    const events: string[] = [];
    try {
        const result = await getAdapter('anthropic')!.invoke({
            agentId: 'test', message: 'hi', workingDir: tmp, systemPrompt: '', model: '', shouldReset: true,
            envOverrides: { PATH: `${fakeBin}:${process.env.PATH}` },
            onEvent: (text) => events.push(text),
        });
        return { result, error: null, events };
    } catch (error) {
        return { result: null, error, events };
    }
}

const assistant = (text: string) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } });

describe('claudeAdapter streaming', () => {
    it('treats a tagged error turn as the failure and never forwards it as an answer', async () => {
        fakeClaude([
            assistant('Let me check.'),
            { ...assistant('Failed to authenticate: OAuth session expired and could not be refreshed'), error: 'authentication_failed' },
            { type: 'result', is_error: true, usage: {} },
        ], 1);
        const { error, result, events } = await invoke();
        expect(result).toBeNull();
        expect((error as { kind?: string }).kind).toBe('auth');
        expect((error as Error).message).toContain('OAuth session expired');
        expect(events).toEqual(['Let me check.']);
    });

    it('takes the kind from the tag even when the text says nothing recognisable', async () => {
        fakeClaude([{ ...assistant('Something went sideways.'), error: 'billing_error' }, { type: 'result', is_error: true }], 1);
        const { error } = await invoke();
        expect((error as { kind?: string }).kind).toBe('billing');
    });

    it('falls back to the last text when an older CLI does not tag the error turn', async () => {
        fakeClaude([
            assistant('Failed to authenticate: OAuth session expired and could not be refreshed'),
            { type: 'result', is_error: true, usage: {} },
        ], 1);
        const { error } = await invoke();
        expect((error as { kind?: string }).kind).toBe('auth');
        expect((error as Error).message).toContain('OAuth session expired');
    });

    it('keeps an answer that arrived before a nonzero exit', async () => {
        fakeClaude([
            assistant('Concrete goes back to Roman times.'),
            { type: 'result', result: 'Concrete goes back to Roman times.' },
        ], 1);
        const { error, result } = await invoke();
        expect(error).toBeNull();
        expect(result).toBe('Concrete goes back to Roman times.');
    });

    it('returns the result on a clean run', async () => {
        fakeClaude([assistant('partial'), { type: 'result', result: 'final' }], 0);
        const { result, events } = await invoke();
        expect(result).toBe('final');
        expect(events).toEqual(['partial']);
    });

    it('still surfaces stderr when the CLI never spoke', async () => {
        const bin = path.join(fakeBin, 'claude');
        fs.writeFileSync(bin, '#!/bin/sh\necho "boom on stderr" >&2\nexit 2\n');
        fs.chmodSync(bin, 0o755);
        const { error } = await invoke();
        expect((error as Error).message).toBe('boom on stderr');
        expect((error as { kind?: string }).kind).toBe('unknown');
    });
});
