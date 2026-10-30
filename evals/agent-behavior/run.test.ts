import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeFakeCli } from '../../packages/testing/src/fake-cli.ts';
import { runEvals, formatTable, closeSession } from './run.ts';
import type { EvalCase } from './cases.ts';

let tmp: string;
let lastReport: Promise<{ fonteHome: string } | undefined> = Promise.resolve(undefined);
let claudeBin: string;
const originalPath = process.env.PATH;

beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fonte-evals-run-'));
    claudeBin = path.join(tmp, 'claude-bin');
    process.env.PATH = `${claudeBin}:${originalPath}`;
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterAll(async () => {
    const report = await lastReport;
    await closeSession();
    if (report) expect(fs.existsSync(report.fonteHome)).toBe(false);
});

afterEach(() => {
    process.env.PATH = originalPath;
    vi.restoreAllMocks();
    fs.rmSync(tmp, { recursive: true, force: true });
});

const RESULT_TEXT = 'Searching now. Severance S02 is on its way.';

function stream(command: string) {
    const session = 'sess-eval-1';
    return [
        { type: 'system', subtype: 'init', session_id: session, tools: ['Bash'] },
        { type: 'assistant', session_id: session, message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command } }] } },
        { type: 'user', session_id: session, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{"ok":true}' }] } },
        { type: 'assistant', session_id: session, message: { role: 'assistant', content: [{ type: 'text', text: RESULT_TEXT }] } },
        { type: 'result', subtype: 'success', is_error: false, result: RESULT_TEXT, session_id: session },
    ];
}

const SEARCH = `curl -s -X POST http://localhost:3777/api/search -H 'Content-Type: application/json' -d '{"query": "Severance"}'`;
const STATUS = 'curl -s http://localhost:3777/api/status';

/** A `claude` that really runs the fake curl (found through PATH), then replays a stream recorded with writeFakeCli. */
function writeAgentCli(opts: { runsCurl: boolean }) {
    const replay = writeFakeCli(claudeBin, 'claude-replay', { lines: stream(SEARCH) });
    const script = [
        '#!/bin/sh',
        'for last; do :; done',
        opts.runsCurl
            ? `case "$last" in *api/status*) ${STATUS} ;; *) ${SEARCH} ;; esac > /dev/null`
            : 'true',
        `exec "${replay.path}" "$@"`,
    ].join('\n');
    fs.writeFileSync(path.join(claudeBin, 'claude'), script + '\n', { mode: 0o755 });
    return replay;
}

const cases: EvalCase[] = [
    {
        id: 'searches', title: 'Searches', expectation: 'pass', message: 'Get me Severance',
        responses: [{ method: 'POST', path: '/api/search', json: { ok: true, resultCount: 0, results: [] } }],
        assert: [{ type: 'called', match: { method: 'POST', path: '/api/search', body: { query: { $regex: 'severance', $flags: 'i' } } } }],
    },
    {
        id: 'stays-quiet', title: 'Stays quiet', expectation: 'pass',
        automation: {
            rule: { id: 'au_test', name: 'Stalled check', prompt: 'Tell me about stalled downloads. Stay quiet if none.', trigger: { type: 'cron', schedule: '0 * * * *' } },
            fired: 'schedule', firedAt: '2026-10-30T09:00:00',
        },
        responses: [],
        assert: [{ type: 'quiet', value: true }],
    },
];

describe('runEvals', { timeout: 30_000 }, () => {
    it('runs each sample through the provider CLI with the fake curl on PATH and grades it', async () => {
        const replay = writeAgentCli({ runsCurl: true });

        const report = await runEvals({ cases, samples: 2, provider: 'anthropic', model: 'sonnet', log: () => {} });
        lastReport = Promise.resolve(report);

        expect(report.fonteHome).not.toBe(path.join(os.homedir(), '.fonte'));
        expect(report.fonteHome.startsWith(fs.realpathSync(os.tmpdir())) || report.fonteHome.startsWith(os.tmpdir())).toBe(true);
        expect(report.rows.map(r => [r.case.id, r.result.status, r.result.failed, r.result.total])).toEqual([
            ['searches', 'pass', 0, 2],
            ['stays-quiet', 'fail', 2, 2],
        ]);
        expect(report.rows[0].samples[0].calls).toEqual([
            expect.objectContaining({ method: 'POST', path: '/api/search', body: { query: 'Severance' }, matched: true }),
        ]);
        expect(report.rows[0].samples[0].finalText).toBe(RESULT_TEXT);
        expect(report.rows[0].samples[0].tools).toEqual([{ name: 'Bash', input: { command: SEARCH } }]);
        expect(report.exitCode).toBe(1);

        const runs = replay.invocations();
        expect(runs).toHaveLength(5);
        const [probe, first, , quiet] = runs;
        expect(probe.argv.at(-1)).toMatch(/api\/status/);
        expect(first.argv).toEqual(expect.arrayContaining(['--dangerously-skip-permissions', '--output-format', 'stream-json', '-p', 'Get me Severance']));
        expect(first.argv).not.toContain('-c');
        expect(first.argv[first.argv.indexOf('--model') + 1]).toMatch(/sonnet/);
        const systemPrompt = first.argv[first.argv.indexOf('--system-prompt') + 1];
        expect(systemPrompt).toContain('# Fonte Agent');
        expect(systemPrompt).toContain('Your automations: none yet.');
        expect(first.cwd).toContain(`${path.basename(report.root)}/samples/searches-1/workspace/fonte`);

        expect(quiet.argv.at(-1)).toMatch(/^\[automation\] "Stalled check" \(id au_test\) is due\./);
        expect(quiet.argv.at(-1)).toContain('Stay quiet if none.');
        expect(quiet.argv[quiet.argv.indexOf('--system-prompt') + 1]).toContain('"Stalled check" (id au_test) [enabled]');

        expect(process.env.PATH).toBe(`${claudeBin}:${originalPath}`);
        expect(fs.existsSync(report.root)).toBe(false);

        const table = formatTable(report.rows);
        expect(table).toMatch(/searches\s+pass\s+pass\s+0\/2/);
        expect(table).toMatch(/stays-quiet\s+pass\s+FAIL\s+2\/2/);
    });

    it('aborts before any case when the probe call does not reach the fake curl', async () => {
        const replay = writeAgentCli({ runsCurl: false });

        await expect(runEvals({ cases, samples: 2, provider: 'anthropic', log: () => {} })).rejects.toThrow(/probe/i);
        expect(replay.invocations()).toHaveLength(1);
    });
});
