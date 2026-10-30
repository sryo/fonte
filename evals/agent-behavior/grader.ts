import { describeCall, describeMatcher, matchCall, matchValue, type CallMatcher } from './match.ts';
import type { Assertion, EvalCase } from './cases.ts';
import type { RecordedCall } from './fake-curl.ts';

/** Mirrors the daemon's check in packages/main: `response.trim() === AUTOMATION_QUIET_REPLY`. */
const QUIET_REPLY = '[quiet]';

export interface Grade {
    pass: boolean;
    reasons: string[];
    observations?: { label: string; held: boolean }[];
}

export type SampleOutcome = Grade | { error: string };

export interface CaseResult {
    status: 'pass' | 'fail' | 'undecided';
    failed: number;
    total: number;
    reasons: { reason: string; samples: number }[];
    observations?: { label: string; held: number }[];
}

function matchesAny(matchers: CallMatcher | CallMatcher[], call: RecordedCall): boolean {
    return (Array.isArray(matchers) ? matchers : [matchers]).some(m => matchCall(m, call));
}

function describeAny(matchers: CallMatcher | CallMatcher[]): string {
    return (Array.isArray(matchers) ? matchers : [matchers]).map(describeMatcher).join(' or ');
}

function check(a: Assertion, calls: RecordedCall[], text: string): string | null {
    switch (a.type) {
        case 'called': {
            const n = calls.filter(c => matchesAny(a.match, c)).length;
            const min = a.min ?? 1;
            if (n < min) return `expected ${describeAny(a.match)} at least ${min} time${min === 1 ? '' : 's'}, saw ${n}`;
            if (a.max !== undefined && n > a.max) return `expected ${describeAny(a.match)} at most ${a.max} time${a.max === 1 ? '' : 's'}, saw ${n}`;
            return null;
        }
        case 'notCalled': {
            const hit = calls.find(c => matchesAny(a.match, c));
            return hit ? `expected no ${describeAny(a.match)}, saw ${describeCall(hit)}` : null;
        }
        case 'before': {
            const first = calls.findIndex(c => matchCall(a.first, c));
            const then = calls.findIndex(c => matchCall(a.then, c));
            if (then === -1) return `expected ${describeMatcher(a.then)} after ${describeMatcher(a.first)}, but it never happened`;
            if (first === -1 || first > then) return `expected ${describeMatcher(a.first)} before ${describeMatcher(a.then)}`;
            return null;
        }
        case 'onlyCalls': {
            const stray = calls.find(c => !a.allow.some(m => matchCall(m, c)));
            return stray ? `unexpected call ${describeCall(stray)}` : null;
        }
        case 'text':
            return matchValue(a.match, text) ? null : `final answer does not satisfy ${JSON.stringify(a.match)}: ${JSON.stringify(text.slice(0, 200))}`;
        case 'mentions': {
            const n = a.patterns.filter(p => new RegExp(p, 'i').test(text)).length;
            return n >= a.min ? null : `final answer mentions ${n} of ${a.patterns.length} expected items, wanted at least ${a.min}`;
        }
        case 'quiet': {
            const quiet = text.trim() === QUIET_REPLY;
            if (quiet === a.value) return null;
            return a.value
                ? `expected exactly ${QUIET_REPLY}, got ${JSON.stringify(text.slice(0, 200))}`
                : `expected a report, got ${QUIET_REPLY}`;
        }
    }
}

export function checkAssertion(a: Assertion, calls: RecordedCall[], text: string): string | null {
    const failure = check(a, calls, text);
    return failure && a.why ? `${a.why}: ${failure}` : failure;
}

export function grade(c: EvalCase, calls: RecordedCall[], finalText: string): Grade {
    if (c.expectation === 'undecided') {
        const observations = (c.observe ?? []).map(o => ({
            label: o.label,
            held: o.assert.every(a => checkAssertion(a, calls, finalText) === null),
        }));
        return { pass: true, reasons: [], observations };
    }
    const reasons = (c.assert ?? []).map(a => checkAssertion(a, calls, finalText)).filter((r): r is string => r !== null);
    return { pass: reasons.length === 0, reasons };
}

/** A decided case fails when at least half of its samples fail; a sample that errored counts as failed. */
export function aggregate(c: EvalCase, samples: SampleOutcome[]): CaseResult {
    const total = samples.length;
    const counts = new Map<string, number>();
    let failed = 0;
    for (const s of samples) {
        const reasons = 'error' in s ? [`run error: ${s.error}`] : s.pass ? [] : s.reasons;
        if ('error' in s || !s.pass) failed++;
        for (const r of reasons) counts.set(r, (counts.get(r) ?? 0) + 1);
    }
    const reasons = [...counts].map(([reason, n]) => ({ reason, samples: n }));

    if (c.expectation === 'undecided') {
        const held = new Map<string, number>((c.observe ?? []).map(o => [o.label, 0]));
        for (const s of samples) {
            if ('error' in s) continue;
            for (const o of s.observations ?? []) if (o.held) held.set(o.label, (held.get(o.label) ?? 0) + 1);
        }
        return { status: 'undecided', failed, total, reasons, observations: [...held].map(([label, n]) => ({ label, held: n })) };
    }

    const status = total === 0 || failed * 2 >= total ? 'fail' : 'pass';
    return { status, failed, total, reasons };
}
