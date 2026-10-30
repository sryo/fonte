import { describe, expect, it } from 'vitest';
import { aggregate, checkAssertion, grade } from './grader.ts';
import { loadCases } from './cases.ts';
import type { Assertion, EvalCase } from './cases.ts';
import type { RecordedCall } from './fake-curl.ts';

function call(method: string, p: string, extra: { query?: Record<string, string>; body?: unknown } = {}): RecordedCall {
    return {
        method, url: `http://localhost:3777${p}`, host: 'localhost:3777', path: p,
        query: extra.query ?? {}, body: extra.body ?? null, status: 200, matched: true,
    };
}

const search = call('POST', '/api/search', { body: { query: 'The Bear', season: 5 } });
const watch = call('POST', '/api/watchlist', { body: { title: 'Glass Orchard', mediaType: 'movie' } });
const list = call('GET', '/api/torrents');
const remove = call('DELETE', '/api/torrents/tr_1');
const removeTrash = call('DELETE', '/api/torrents/tr_1', { query: { deleteFiles: 'true' } });

describe('checkAssertion', () => {
    it('called counts matching calls against min and max', () => {
        expect(checkAssertion({ type: 'called', match: { method: 'POST', path: '/api/search' } }, [search], '')).toBeNull();
        expect(checkAssertion({ type: 'called', match: { method: 'POST', path: '/api/search' } }, [list], '')).toMatch(/POST \/api\/search.*0/);
        expect(checkAssertion({ type: 'called', match: { path: '/api/search' }, max: 1 }, [search, search], '')).toMatch(/at most 1.*2/);
        expect(checkAssertion({ type: 'called', match: [{ path: '/api/search' }, { path: '/api/watchlist' }], min: 2, max: 2 }, [search, watch], '')).toBeNull();
    });

    it('matches path parameters, loose primitives and body subsets', () => {
        expect(checkAssertion({ type: 'called', match: { method: 'DELETE', path: '/api/torrents/:id' } }, [remove], '')).toBeNull();
        expect(checkAssertion({ type: 'called', match: { body: { season: '5', query: { $regex: 'bear', $flags: 'i' } } } }, [search], '')).toBeNull();
        expect(checkAssertion({ type: 'called', match: { body: { season: 4 } } }, [search], '')).not.toBeNull();
        expect(checkAssertion({ type: 'called', match: { path: { $regex: '^/api/torrents' } } }, [list], '')).toBeNull();
        expect(checkAssertion({ type: 'called', match: { method: { $in: ['POST', 'PUT', 'DELETE'] } } }, [list], '')).not.toBeNull();
    });

    it('notCalled fails on any matching call and says which', () => {
        const noTrash: Assertion = { type: 'notCalled', match: { method: 'DELETE', query: { deleteFiles: { $exists: true } } } };
        expect(checkAssertion(noTrash, [list, remove], '')).toBeNull();
        expect(checkAssertion(noTrash, [list, removeTrash], '')).toMatch(/DELETE \/api\/torrents\/tr_1\?deleteFiles=true/);
    });

    it('before needs both calls with the first one earlier', () => {
        const a: Assertion = { type: 'before', first: { path: '/api/search' }, then: { path: '/api/watchlist' } };
        expect(checkAssertion(a, [search, watch], '')).toBeNull();
        expect(checkAssertion(a, [watch, search], '')).not.toBeNull();
        expect(checkAssertion(a, [search], '')).not.toBeNull();
    });

    it('onlyCalls rejects a call outside the allow list', () => {
        const a: Assertion = { type: 'onlyCalls', allow: [{ method: 'GET' }] };
        expect(checkAssertion(a, [list], '')).toBeNull();
        expect(checkAssertion(a, [list, remove], '')).toMatch(/DELETE \/api\/torrents\/tr_1/);
    });

    it('text, mentions and quiet look at the final answer', () => {
        expect(checkAssertion({ type: 'text', match: { $regex: 'monitor', $flags: 'i' } }, [], 'I am Monitoring it.')).toBeNull();
        expect(checkAssertion({ type: 'text', match: { $not: { $regex: 'which quality', $flags: 'i' } } }, [], 'Which quality do you want?')).not.toBeNull();
        expect(checkAssertion({ type: 'mentions', patterns: ['2160p', '1080p', '720p'], min: 2 }, [], 'Got 1080p and 720p.')).toBeNull();
        expect(checkAssertion({ type: 'mentions', patterns: ['2160p', '1080p', '720p'], min: 2 }, [], 'Got 1080p.')).toMatch(/1 of 3/);
        expect(checkAssertion({ type: 'quiet', value: true }, [], '  [quiet]\n')).toBeNull();
        expect(checkAssertion({ type: 'quiet', value: true }, [], '[quiet] nothing stalled')).not.toBeNull();
        expect(checkAssertion({ type: 'quiet', value: false }, [], '[quiet]')).not.toBeNull();
    });

    it('prefers the case author\'s why in the reason', () => {
        expect(checkAssertion({ type: 'called', match: { path: '/api/search' }, why: 'searches first' }, [], '')).toMatch(/^searches first: /);
    });
});

const decided: EvalCase = {
    id: 'season', title: 'Season', expectation: 'pass', message: 'Download season 5 of The Bear', responses: [],
    assert: [
        { type: 'called', match: { method: 'POST', path: '/api/search', body: { season: 5 } } },
        { type: 'notCalled', match: { method: 'DELETE' } },
    ],
};

const undecided: EvalCase = {
    id: 'pick', title: 'Pick', expectation: 'undecided', note: 'contradiction', message: 'Download Dune', responses: [],
    observe: [
        { label: 'added a torrent', assert: [{ type: 'called', match: { method: 'POST', path: '/api/torrents' } }] },
        { label: 'listed results', assert: [{ type: 'mentions', patterns: ['a', 'b', 'c'], min: 3 }] },
    ],
};

describe('grade', () => {
    it('passes when every assertion holds and lists each failure otherwise', () => {
        expect(grade(decided, [search], 'Started.')).toEqual({ pass: true, reasons: [] });
        const failed = grade(decided, [call('POST', '/api/search', { body: { query: 'The Bear' } }), remove], '');
        expect(failed.pass).toBe(false);
        expect(failed.reasons).toHaveLength(2);
    });

    it('records observations for an undecided case and never fails it', () => {
        const g = grade(undecided, [call('POST', '/api/torrents', { body: { magnetUri: 'magnet:?' } })], 'only a');
        expect(g.pass).toBe(true);
        expect(g.observations).toEqual([{ label: 'added a torrent', held: true }, { label: 'listed results', held: false }]);
    });
});

describe('aggregate', () => {
    const passG = { pass: true, reasons: [] };
    const failG = { pass: false, reasons: ['searches first: expected POST /api/search, saw 0'] };

    it('fails a case when at least half of its samples fail', () => {
        expect(aggregate(decided, [passG, failG]).status).toBe('fail');
        expect(aggregate(decided, [failG, failG, passG, passG]).status).toBe('fail');
        expect(aggregate(decided, [passG, passG, failG]).status).toBe('pass');
        expect(aggregate(decided, [passG, passG]).status).toBe('pass');
    });

    it('counts a sample that errored as failed and groups identical reasons', () => {
        const agg = aggregate(decided, [{ error: 'claude exited 1' }, failG, failG, passG]);
        expect(agg).toMatchObject({ status: 'fail', failed: 3, total: 4 });
        expect(agg.reasons).toEqual([
            { reason: 'run error: claude exited 1', samples: 1 },
            { reason: 'searches first: expected POST /api/search, saw 0', samples: 2 },
        ]);
    });

    it('fails a case with no samples', () => {
        expect(aggregate(decided, []).status).toBe('fail');
    });

    it('reports undecided cases as undecided with observation tallies', () => {
        const a = { pass: true, reasons: [], observations: [{ label: 'added a torrent', held: true }, { label: 'listed results', held: false }] };
        const b = { pass: true, reasons: [], observations: [{ label: 'added a torrent', held: true }, { label: 'listed results', held: true }] };
        expect(aggregate(undecided, [a, b])).toMatchObject({
            status: 'undecided', failed: 0, total: 2,
            observations: [{ label: 'added a torrent', held: 2 }, { label: 'listed results', held: 1 }],
        });
    });
});

describe('cases', () => {
    it('loads every case file and each one is well formed', () => {
        const cases = loadCases();
        expect(cases.length).toBeGreaterThanOrEqual(10);
        expect(new Set(cases.map(c => c.id)).size).toBe(cases.length);
        for (const c of cases) {
            if (c.expectation === 'undecided') expect(c.note, c.id).toBeTruthy();
        }
    });

    it('each decided case passes its own golden transcript and fails an empty one', () => {
        for (const c of loadCases()) {
            if (c.expectation !== 'pass') continue;
            expect(c.golden, c.id).toBeDefined();
            const golden = grade(c, c.golden!.calls.map(g => ({ ...call(g.method, g.path, g), matched: true })), c.golden!.text);
            expect(golden, c.id).toEqual({ pass: true, reasons: [] });
            expect(grade(c, [], '').pass, c.id).toBe(false);
            for (const [i, bad] of (c.bad ?? []).entries()) {
                expect(grade(c, bad.calls.map(g => call(g.method, g.path, g)), bad.text).pass, `${c.id} bad[${i}]`).toBe(false);
            }
        }
    });
});
