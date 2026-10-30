import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { CallMatcher, ValueMatcher } from './match.ts';
import type { CannedResponse } from './fake-curl.ts';

export type Assertion = { why?: string } & (
    | { type: 'called'; match: CallMatcher | CallMatcher[]; min?: number; max?: number }
    | { type: 'notCalled'; match: CallMatcher | CallMatcher[] }
    | { type: 'before'; first: CallMatcher; then: CallMatcher }
    | { type: 'onlyCalls'; allow: CallMatcher[] }
    | { type: 'text'; match: ValueMatcher }
    | { type: 'mentions'; patterns: string[]; min: number }
    | { type: 'quiet'; value: boolean }
);

export interface Observation {
    label: string;
    assert: Assertion[];
}

/** Fed to the real `buildWakePrompt`, and the rule is seeded so the system prompt lists it. */
export interface AutomationFiring {
    rule: { id: string; name: string; prompt: string; trigger: unknown };
    fired: 'event' | 'schedule' | 'manual';
    events?: { type: string; data: Record<string, unknown> }[];
    firedAt: string;
}

export interface Transcript {
    calls: { method: string; path: string; query?: Record<string, string>; body?: unknown }[];
    text: string;
}

export interface EvalCase {
    id: string;
    title: string;
    expectation: 'pass' | 'undecided';
    note?: string;
    message?: string;
    automation?: AutomationFiring;
    responses: CannedResponse[];
    assert?: Assertion[];
    observe?: Observation[];
    /** A hand-written run that must pass, so the assertions are known to be satisfiable. */
    golden?: Transcript;
    /** Hand-written runs that must fail. */
    bad?: Transcript[];
}

export const CASES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cases');

/** Appended after each case's own responses, so a case can override any of them. */
export const DEFAULT_RESPONSES: CannedResponse[] = [
    { method: 'GET', path: '/api/status', json: { ok: true, uptime: 5400, server: { running: true, port: 3777 }, listenPort: 51413 } },
    { method: 'GET', path: '/api/torrents/stats', json: { ok: true, downloadSpeed: 0, uploadSpeed: 0, activeTorrents: 0, totalTorrents: 0 } },
    { method: 'GET', path: '/api/torrents', json: { ok: true, torrents: [] } },
    { method: 'GET', path: '/api/watchlist', json: { ok: true, entries: [] } },
    { method: 'GET', path: '/api/automations', json: { ok: true, rules: [] } },
    { method: 'GET', path: '/api/agents', json: { ok: true, agents: { fonte: { name: 'Fonte Agent', provider: 'anthropic', model: 'sonnet' } } } },
];

const ASSERTION_TYPES = new Set(['called', 'notCalled', 'before', 'onlyCalls', 'text', 'mentions', 'quiet']);

function validate(c: EvalCase, file: string): void {
    const problems: string[] = [];
    if (!c.id || !c.title) problems.push('id and title are required');
    if (c.expectation !== 'pass' && c.expectation !== 'undecided') problems.push('expectation must be "pass" or "undecided"');
    if (Boolean(c.message) === Boolean(c.automation)) problems.push('exactly one of message or automation is required');
    if (!Array.isArray(c.responses)) problems.push('responses must be an array');
    if (c.expectation === 'pass' && !c.assert?.length) problems.push('a decided case needs assert');
    if (c.expectation === 'undecided' && (!c.note || !c.observe?.length)) problems.push('an undecided case needs a note and observe');
    const assertions = [...(c.assert ?? []), ...(c.observe ?? []).flatMap(o => o.assert)];
    for (const a of assertions) {
        if (!ASSERTION_TYPES.has(a.type)) problems.push(`unknown assertion type ${JSON.stringify(a.type)}`);
    }
    if (problems.length) throw new Error(`${file}: ${problems.join('; ')}`);
}

export function loadCases(dir: string = CASES_DIR): EvalCase[] {
    return fs.readdirSync(dir)
        .filter(f => f.endsWith('.json'))
        .sort()
        .map(f => {
            const c = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as EvalCase;
            validate(c, f);
            return c;
        });
}
