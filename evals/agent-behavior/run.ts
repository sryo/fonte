import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { parseArgs } from 'util';
import { DEFAULT_RESPONSES, loadCases, type EvalCase } from './cases.ts';
import { readCalls, writeFakeCurl, type RecordedCall } from './fake-curl.ts';
import { aggregate, grade, type CaseResult, type SampleOutcome } from './grader.ts';

export interface RunOptions {
    cases?: EvalCase[];
    samples?: number;
    provider?: string;
    model?: string;
    timeoutMs?: number;
    keep?: boolean;
    log?: (line: string) => void;
}

export interface SampleRecord {
    dir: string;
    calls: RecordedCall[];
    finalText: string;
    tools: { name: string; input: unknown }[];
    outcome: SampleOutcome;
}

export interface CaseRow {
    case: EvalCase;
    result: CaseResult;
    samples: SampleRecord[];
}

export interface RunReport {
    root: string;
    fonteHome: string;
    rows: CaseRow[];
    exitCode: number;
}

const AGENT_ID = 'fonte';
const PROBE_MESSAGE = 'Run this exact shell command and reply with only its output: curl -s http://localhost:3777/api/status';

interface Session {
    fonteHome: string;
    core: any;
    automationDb: any;
    automationPrompt: any;
}

let session: Promise<Session> | undefined;
let closed = false;

async function load(specifier: string): Promise<any> {
    const mod = await import(specifier);
    return mod.default ?? mod;
}

/**
 * @fonte/core reads FONTE_HOME once, at import, so the whole process shares
 * one throwaway home; it is created before the first import and removed on exit.
 */
function loadSession(): Promise<Session> {
    if (closed) throw new Error('The eval session was closed. Run the evals in a fresh process.');
    session ??= (async () => {
        const fonteHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fonte-evals-home-'));
        fs.mkdirSync(path.join(fonteHome, 'logs'));
        process.once('exit', () => fs.rmSync(fonteHome, { recursive: true, force: true }));
        const previous = process.env.FONTE_HOME;
        process.env.FONTE_HOME = fonteHome;
        try {
            const core = await load('@fonte/core');
            if (path.resolve(core.FONTE_HOME) !== path.resolve(fonteHome)) {
                throw new Error(`@fonte/core was already loaded with FONTE_HOME=${core.FONTE_HOME}. Run the evals in a fresh process.`);
            }
            (await load('@fonte/torrent/dist/torrent-db.js')).initTorrentDb();
            const automationDb = await load('@fonte/torrent/dist/automation-db.js');
            const automationPrompt = await load('@fonte/torrent/dist/automation-prompt.js');
            core.registerSystemPromptSection('automations', automationPrompt.renderAutomationsSection);
            return { fonteHome, core, automationDb, automationPrompt };
        } finally {
            if (previous === undefined) delete process.env.FONTE_HOME;
            else process.env.FONTE_HOME = previous;
        }
    })();
    return session;
}

/** Removes the process's throwaway home. Later runs in the same process are refused. */
export async function closeSession(): Promise<void> {
    if (!session || closed) return;
    closed = true;
    const s = await session;
    (await load('@fonte/torrent/dist/db-connection.js')).closeDb();
    fs.rmSync(s.fonteHome, { recursive: true, force: true });
}

function messageFor(s: Session, c: EvalCase): string {
    for (const rule of s.automationDb.getAutomationRules()) s.automationDb.deleteAutomationRule(rule.id);
    if (!c.automation) return c.message!;
    const { rule, fired, events, firedAt } = c.automation;
    s.automationDb.insertAutomationRule({ ...rule, agentId: AGENT_ID });
    return s.automationPrompt.buildWakePrompt(rule, { trigger: fired, events, firedAt: Date.parse(firedAt) });
}

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            onTimeout();
            reject(new Error(`timed out after ${Math.round(ms / 1000)}s`));
        }, ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

async function runAgent(s: Session, agent: Record<string, unknown>, dir: string, c: EvalCase, timeoutMs: number): Promise<Omit<SampleRecord, 'outcome'> & { error?: string }> {
    const bin = path.join(dir, 'bin');
    const callsLog = path.join(dir, 'calls.jsonl');
    const responsesFile = path.join(dir, 'responses.json');
    const envFile = path.join(dir, 'env.sh');
    const workspace = path.join(dir, 'workspace');
    const agentDir = path.join(workspace, AGENT_ID);
    // Created up front: invokeAgent copies the repo's .claude into an agent dir it creates.
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(responsesFile, JSON.stringify([...c.responses, ...DEFAULT_RESPONSES]));
    writeFakeCurl(bin, { callsLog, responsesFile });
    // Claude Code sources this before every Bash command, after the user's shell snapshot may have reordered PATH.
    fs.writeFileSync(envFile, `export PATH=${shellQuote(bin)}:"$PATH"\n`);

    const config = { ...agent, working_directory: agentDir };
    const tools: { name: string; input: unknown }[] = [];
    const saved = { PATH: process.env.PATH, CLAUDE_ENV_FILE: process.env.CLAUDE_ENV_FILE };
    process.env.PATH = `${bin}${path.delimiter}${saved.PATH ?? ''}`;
    process.env.CLAUDE_ENV_FILE = envFile;
    try {
        const message = messageFor(s, c);
        const finalText: string = await withTimeout(
            s.core.invokeAgent(config, AGENT_ID, message, workspace, true, { [AGENT_ID]: config }, {}, {
                onEvent: () => {},
                onTool: (name: string, input: unknown) => { tools.push({ name, input }); },
            }),
            timeoutMs,
            () => s.core.killAgentProcess(AGENT_ID),
        );
        return { dir, calls: readCalls(callsLog), finalText, tools };
    } catch (err) {
        return { dir, calls: readCalls(callsLog), finalText: '', tools, error: (err as Error).message };
    } finally {
        process.env.PATH = saved.PATH;
        if (saved.CLAUDE_ENV_FILE === undefined) delete process.env.CLAUDE_ENV_FILE;
        else process.env.CLAUDE_ENV_FILE = saved.CLAUDE_ENV_FILE;
    }
}

export async function runEvals(opts: RunOptions = {}): Promise<RunReport> {
    const log = opts.log ?? ((line: string) => process.stdout.write(line + '\n'));
    const samples = opts.samples ?? 2;
    const timeoutMs = opts.timeoutMs ?? 5 * 60_000;
    const cases = opts.cases ?? loadCases().filter(c => c.expectation === 'pass');
    const s = await loadSession();
    const defaults = s.core.getDefaultAgentFromModels({ models: { provider: opts.provider ?? 'anthropic' } });
    const agent = { ...defaults, ...(opts.model ? { model: opts.model } : {}) };
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fonte-evals-'));

    try {
        log(`Provider ${agent.provider}, model ${agent.model || '(CLI default)'}, ${cases.length} cases x ${samples} samples. Work dir ${root}`);
        const probeCase: EvalCase = { id: 'probe', title: 'Probe', expectation: 'pass', message: PROBE_MESSAGE, responses: [] };
        const probe = await runAgent(s, agent, path.join(root, 'probe'), probeCase, timeoutMs);
        if (!probe.calls.some(call => call.method === 'GET' && call.path === '/api/status')) {
            throw new Error(`Probe failed: the agent's curl never reached the fake curl${probe.error ? ` (${probe.error})` : ''}. Aborting before any case could reach a real daemon.`);
        }

        const rows: CaseRow[] = [];
        for (const [ci, c] of cases.entries()) {
            const records: SampleRecord[] = [];
            for (let i = 0; i < samples; i++) {
                const started = Date.now();
                const run = await runAgent(s, agent, path.join(root, 'samples', `${c.id}-${i + 1}`), c, timeoutMs);
                const outcome: SampleOutcome = run.error ? { error: run.error } : grade(c, run.calls, run.finalText);
                const { error: _error, ...record } = run;
                records.push({ ...record, outcome });
                const verdict = 'error' in outcome ? 'error' : c.expectation === 'undecided' ? 'observed' : outcome.pass ? 'pass' : 'fail';
                log(`[${ci + 1}/${cases.length}] ${c.id} sample ${i + 1}/${samples}: ${verdict} (${Math.round((Date.now() - started) / 1000)}s)`);
            }
            rows.push({ case: c, result: aggregate(c, records.map(r => r.outcome)), samples: records });
        }
        return { root, fonteHome: s.fonteHome, rows, exitCode: rows.some(r => r.result.status === 'fail') ? 1 : 0 };
    } finally {
        if (!opts.keep) fs.rmSync(root, { recursive: true, force: true });
    }
}

export function formatTable(rows: CaseRow[]): string {
    const header = ['case', 'expect', 'result', 'failed'];
    const cells = rows.map(r => [
        r.case.id,
        r.case.expectation,
        r.result.status === 'fail' ? 'FAIL' : r.result.status,
        `${r.result.failed}/${r.result.total}`,
    ]);
    const widths = header.map((h, i) => Math.max(h.length, ...cells.map(row => row[i].length)));
    const line = (row: string[]) => row.map((cell, i) => cell.padEnd(widths[i])).join('  ').trimEnd();
    const out = [line(header), line(widths.map(w => '-'.repeat(w)))];
    for (const [i, r] of rows.entries()) {
        out.push(line(cells[i]));
        for (const o of r.result.observations ?? []) out.push(`    ${o.held}/${r.result.total} ${o.label}`);
        for (const reason of r.result.reasons) out.push(`    ${reason.samples}/${r.result.total} ${reason.reason}`);
    }
    return out.join('\n');
}

function describeSample(sample: SampleRecord): string {
    const commands = sample.tools.map(t => {
        const input = t.input as { command?: unknown } | undefined;
        return `      ${t.name}: ${typeof input?.command === 'string' ? input.command : JSON.stringify(t.input)}`;
    });
    return [...commands, `      answer: ${JSON.stringify(sample.finalText)}`].join('\n');
}

async function main(): Promise<void> {
    const print = (text: string) => process.stdout.write(text + '\n');
    const { values } = parseArgs({
        options: {
            provider: { type: 'string', default: 'anthropic' },
            model: { type: 'string' },
            samples: { type: 'string', default: '2' },
            case: { type: 'string', multiple: true },
            'include-undecided': { type: 'boolean', default: false },
            timeout: { type: 'string', default: '300' },
            keep: { type: 'boolean', default: false },
            verbose: { type: 'boolean', default: false },
        },
    });
    const samples = Number(values.samples);
    if (!Number.isInteger(samples) || samples < 2) throw new Error('--samples must be an integer of at least 2');
    const wanted = (values.case ?? []).flatMap(v => v.split(',')).filter(Boolean);
    const all = loadCases();
    const unknown = wanted.filter(id => !all.some(c => c.id === id));
    if (unknown.length) throw new Error(`Unknown case: ${unknown.join(', ')}`);
    const cases = wanted.length
        ? all.filter(c => wanted.includes(c.id))
        : all.filter(c => c.expectation === 'pass' || values['include-undecided']);

    if (!values.verbose) console.log = () => {};
    const report = await runEvals({
        cases, samples, provider: values.provider, model: values.model,
        timeoutMs: Number(values.timeout) * 1000, keep: values.keep,
    });
    print('\n' + formatTable(report.rows));
    if (values.verbose) {
        for (const row of report.rows) {
            for (const [i, sample] of row.samples.entries()) {
                const failed = 'error' in sample.outcome || !sample.outcome.pass || row.case.expectation === 'undecided';
                if (failed) print(`\n${row.case.id} sample ${i + 1}:\n${describeSample(sample)}`);
            }
        }
    }
    if (values.keep) print(`\nKept ${report.root}`);
    process.exitCode = report.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    main().catch(err => {
        console.error(err instanceof Error ? err.message : err);
        process.exitCode = 2;
    });
}
