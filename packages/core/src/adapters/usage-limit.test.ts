import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFakeCli, loadRecording } from '../../../testing/src/fake-cli';

let tmp: string;
let bin: string;

beforeEach(() => {
    vi.resetModules();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fonte-adapter-limit-test-'));
    bin = path.join(tmp, 'bin');
});

afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
});

async function failure(provider: string): Promise<{ kind?: string; resetsAt?: number; message: string }> {
    const { getAdapter } = await import('./index');
    try {
        await getAdapter(provider)!.invoke({
            agentId: 'test', message: 'hi', workingDir: tmp, systemPrompt: '', model: '', shouldReset: false,
            envOverrides: { PATH: `${bin}:${process.env.PATH}` },
            onEvent: () => {},
        });
    } catch (error) {
        return error as { kind?: string; resetsAt?: number; message: string };
    }
    throw new Error('expected the run to fail');
}

const RESET_MS = 1798732800_000;
const lines = (name: string) => loadRecording(name).map(line => JSON.parse(line));

describe('claude usage limit', () => {
    it('takes the reset from the error turn of a current CLI', async () => {
        writeFakeCli(bin, 'claude', { lines: loadRecording('claude-usage-limit'), exitCode: 1 });
        const error = await failure('anthropic');
        expect(error.kind).toBe('rate_limit');
        expect(error.resetsAt).toBe(RESET_MS);
        expect(error.message).toContain("You've hit your 5-hour limit");
    });

    it('falls back to the rejected rate_limit_event when the error turn carries no reset', async () => {
        const recording = lines('claude-usage-limit').map(line => {
            if (line.type === 'rate_limit_event' && line.rate_limit_info.status === 'rejected') {
                return { ...line, rate_limit_info: { ...line.rate_limit_info, resetsAt: 1798736400 } };
            }
            if (line.type === 'assistant' && line.error) {
                const { api_error_params: _params, ...rest } = line;
                return { ...rest, message: { ...line.message, content: [{ type: 'text', text: 'Usage limit hit' }] } };
            }
            return line;
        });
        writeFakeCli(bin, 'claude', { lines: recording, exitCode: 1 });
        const error = await failure('anthropic');
        expect(error.resetsAt).toBe(1798736400_000);
    });

    it('ignores a warning-only rate_limit_event and reads the reset from the text instead', async () => {
        const recording = lines('claude-usage-limit').filter(line => !(line.type === 'rate_limit_event' && line.rate_limit_info.status === 'rejected'))
            .map(line => {
                if (line.type !== 'assistant' || !line.error) return line;
                const { api_error_params: _params, ...rest } = line;
                return rest;
            });
        writeFakeCli(bin, 'claude', { lines: recording, exitCode: 1 });
        const error = await failure('anthropic');
        expect(error.kind).toBe('rate_limit');
        const resetsAt = error.resetsAt!;
        expect(new Date(resetsAt).getUTCHours()).toBe(16);
        expect(new Date(resetsAt).getUTCMinutes()).toBe(0);
        expect(resetsAt).toBeGreaterThan(Date.now());
        expect(resetsAt - Date.now()).toBeLessThanOrEqual(24 * 3_600_000);
    });

    it('reads the epoch seconds an older CLI appends to the limit message', async () => {
        writeFakeCli(bin, 'claude', { lines: loadRecording('claude-usage-limit-legacy'), exitCode: 1 });
        const error = await failure('anthropic');
        expect(error.kind).toBe('rate_limit');
        expect(error.resetsAt).toBe(RESET_MS);
    });

    it('does not pin an overloaded error to an earlier rejected limit', async () => {
        const recording = lines('claude-usage-limit').map(line => {
            if (line.type !== 'assistant' || !line.error) return line;
            const { api_error_params: _params, ...rest } = line;
            return { ...rest, error: 'overloaded', message: { ...line.message, content: [{ type: 'text', text: 'API Error: 529 Overloaded' }] } };
        });
        writeFakeCli(bin, 'claude', { lines: recording, exitCode: 1 });
        const error = await failure('anthropic');
        expect(error.kind).toBe('rate_limit');
        expect(error.resetsAt).toBeUndefined();
    });

    it('attaches no reset to a failure that is not a rate limit', async () => {
        const recording = lines('claude-usage-limit').map(line =>
            line.type === 'assistant' && line.error ? { ...line, error: 'billing_error' } : line);
        writeFakeCli(bin, 'claude', { lines: recording, exitCode: 1 });
        const error = await failure('anthropic');
        expect(error.kind).toBe('billing');
        expect(error.resetsAt).toBeUndefined();
    });
});

describe('codex usage limit', () => {
    it("reads the local try-again time from the turn's error", async () => {
        writeFakeCli(bin, 'codex', { lines: loadRecording('codex-usage-limit'), exitCode: 1 });
        const before = Date.now();
        const error = await failure('openai');
        expect(error.kind).toBe('rate_limit');
        const expected = new Date(before);
        expected.setHours(15, 42, 0, 0);
        if (expected.getTime() <= before) expected.setDate(expected.getDate() + 1);
        expect(error.resetsAt).toBe(expected.getTime());
    });

    it('leaves the reset unknown when the error gives none', async () => {
        writeFakeCli(bin, 'codex', {
            lines: [{ type: 'thread.started', thread_id: 't1' }, { type: 'turn.failed', error: { message: "You've hit your usage limit." } }],
            exitCode: 1,
        });
        const error = await failure('openai');
        expect(error.kind).toBe('rate_limit');
        expect(error.resetsAt).toBeUndefined();
    });
});
