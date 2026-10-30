import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseCurlArgs, findResponse, writeFakeCurl, readCalls } from './fake-curl.ts';
import type { CannedResponse } from './fake-curl.ts';

let dir: string;

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fonte-fake-curl-'));
});

afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

describe('parseCurlArgs', () => {
    it('reads the method, path and JSON body of the documented search call', () => {
        const [req] = parseCurlArgs([
            '-X', 'POST', 'http://localhost:3777/api/search', '-H', 'Content-Type: application/json',
            '-d', '{"query": "The Bear", "season": 5}',
        ]);
        expect(req).toMatchObject({ method: 'POST', host: 'localhost:3777', path: '/api/search', query: {}, body: { query: 'The Bear', season: 5 } });
    });

    it('defaults to GET with no body', () => {
        const [req] = parseCurlArgs(['-s', 'http://localhost:3777/api/torrents']);
        expect(req).toMatchObject({ method: 'GET', path: '/api/torrents', body: null });
    });

    it('splits the query string off the path', () => {
        const [req] = parseCurlArgs(['-sS', '-XDELETE', 'http://localhost:3777/api/torrents/tr_1?deleteFiles=true']);
        expect(req).toMatchObject({ method: 'DELETE', path: '/api/torrents/tr_1', query: { deleteFiles: 'true' } });
    });

    it('takes an option value from the rest of a short flag cluster or the next argument', () => {
        const [req] = parseCurlArgs(['-sX', 'POST', 'http://localhost:3777/api/torrents/tr_1/pause']);
        expect(req.method).toBe('POST');
        const [attached] = parseCurlArgs(['-d{"a":1}', 'http://localhost:3777/api/x']);
        expect(attached.body).toEqual({ a: 1 });
    });

    it('turns data into POST unless -G moves it into the query', () => {
        expect(parseCurlArgs(['-d', '{"a":1}', 'http://localhost:3777/api/x'])[0].method).toBe('POST');
        const [req] = parseCurlArgs(['-G', '--data-urlencode', 'status=seeding now', '-d', 'limit=5', 'http://localhost:3777/api/torrents']);
        expect(req).toMatchObject({ method: 'GET', query: { status: 'seeding now', limit: '5' }, body: null });
    });

    it('accepts --json, --request, --url and long data options', () => {
        const [req] = parseCurlArgs(['--request', 'PUT', '--url', 'http://127.0.0.1:3777/api/automations/a1', '--json', '{"enabled": false}']);
        expect(req).toMatchObject({ method: 'PUT', path: '/api/automations/a1', body: { enabled: false } });
        expect(parseCurlArgs(['--json', '{}', 'http://localhost:3777/api/x'])[0].method).toBe('POST');
        expect(parseCurlArgs(['--data-raw', '@not-a-file', 'http://localhost:3777/api/x'])[0].body).toBe('@not-a-file');
    });

    it('reads @file and @- bodies', () => {
        const file = path.join(dir, 'body.json');
        fs.writeFileSync(file, '{"magnetUri": "magnet:?xt=urn:btih:abc"}');
        expect(parseCurlArgs(['-d', `@${file}`, 'http://localhost:3777/api/torrents'])[0].body).toEqual({ magnetUri: 'magnet:?xt=urn:btih:abc' });
        const [req] = parseCurlArgs(['--data-binary', '@-', 'http://localhost:3777/api/torrents'], { stdin: () => '{"filePath": "/x.torrent"}' });
        expect(req.body).toEqual({ filePath: '/x.torrent' });
    });

    it('adds a scheme to a bare host and keeps output options', () => {
        const [req] = parseCurlArgs(['-o', '/dev/null', '-w', '%{http_code}', '-f', 'localhost:3777/api/status']);
        expect(req).toMatchObject({ method: 'GET', host: 'localhost:3777', path: '/api/status', output: '/dev/null', writeOut: '%{http_code}', fail: true });
    });

    it('returns one request per URL', () => {
        const reqs = parseCurlArgs(['-s', 'http://localhost:3777/api/torrents', 'http://localhost:3777/api/watchlist']);
        expect(reqs.map(r => r.path)).toEqual(['/api/torrents', '/api/watchlist']);
    });
});

describe('findResponse', () => {
    const rules: CannedResponse[] = [
        { method: 'POST', path: '/api/search', body: { query: { $regex: '^magnet:' } }, json: { ok: true, action: 'added' } },
        { method: 'POST', path: '/api/search', json: { ok: true, results: [] } },
        { method: 'GET', path: '/api/torrents/stats', json: { ok: true, stats: true } },
        { method: 'GET', path: '/api/torrents/:id', json: { ok: true, detail: true } },
        { method: 'DELETE', path: '/api/torrents/:id', query: { deleteFiles: 'true' }, status: 500, json: { ok: false, error: 'trashed' } },
        { path: '/api/watchlist', json: { ok: true, any: true } },
    ];
    const req = (method: string, p: string, extra: { query?: Record<string, string>; body?: unknown } = {}) =>
        ({ method, url: `http://localhost:3777${p}`, host: 'localhost:3777', path: p, query: extra.query ?? {}, body: extra.body ?? null });

    it('picks the first rule whose method, path, query and body match', () => {
        expect(findResponse(rules, req('POST', '/api/search', { body: { query: 'magnet:?xt=urn:btih:abc' } })).json).toEqual({ ok: true, action: 'added' });
        expect(findResponse(rules, req('POST', '/api/search', { body: { query: 'Dune' } })).json).toEqual({ ok: true, results: [] });
        expect(findResponse(rules, req('GET', '/api/torrents/stats')).json).toEqual({ ok: true, stats: true });
        expect(findResponse(rules, req('GET', '/api/torrents/tr_9')).json).toEqual({ ok: true, detail: true });
        expect(findResponse(rules, req('DELETE', '/api/torrents/tr_9', { query: { deleteFiles: 'true' } }))).toMatchObject({ status: 500, matched: true });
        expect(findResponse(rules, req('POST', '/api/watchlist')).json).toEqual({ ok: true, any: true });
    });

    it("answers an unknown endpoint the way the daemon does and flags it as unmatched", () => {
        expect(findResponse(rules, req('DELETE', '/api/torrents/tr_9'))).toEqual({ status: 404, json: { ok: false, error: 'Not found' }, matched: false });
    });
});

describe('fake curl executable', () => {
    function setup(responses: CannedResponse[]) {
        const binDir = path.join(dir, 'bin');
        const callsLog = path.join(dir, 'calls.jsonl');
        const responsesFile = path.join(dir, 'responses.json');
        fs.writeFileSync(responsesFile, JSON.stringify(responses));
        writeFakeCurl(binDir, { callsLog, responsesFile });
        const run = (args: string[], input?: string) => spawnSync(path.join(binDir, 'curl'), args, { encoding: 'utf8', input });
        return { run, callsLog, binDir };
    }

    it('prints the canned JSON and logs the call', () => {
        const { run, callsLog } = setup([{ method: 'POST', path: '/api/search', json: { ok: true, resultCount: 0, results: [] } }]);
        const out = run(['-s', '-X', 'POST', 'http://localhost:3777/api/search', '-H', 'Content-Type: application/json', '-d', '{"query": "Dune"}']);
        expect(out.status).toBe(0);
        expect(JSON.parse(out.stdout)).toEqual({ ok: true, resultCount: 0, results: [] });
        expect(readCalls(callsLog)).toEqual([
            expect.objectContaining({ method: 'POST', path: '/api/search', query: {}, body: { query: 'Dune' }, status: 200, matched: true }),
        ]);
    });

    it('reads a @- body from stdin', () => {
        const { run, callsLog } = setup([]);
        run(['-d', '@-', 'http://localhost:3777/api/torrents'], '{"magnetUri": "magnet:?xt=urn:btih:abc"}');
        expect(readCalls(callsLog)[0].body).toEqual({ magnetUri: 'magnet:?xt=urn:btih:abc' });
    });

    it('honours -f, -o and -w', () => {
        const { run } = setup([{ path: '/api/status', json: { ok: true } }]);
        const failed = run(['-sf', 'http://localhost:3777/api/nope']);
        expect(failed.status).toBe(22);
        expect(failed.stdout).toBe('');
        const outFile = path.join(dir, 'out.json');
        const written = run(['-s', '-o', outFile, '-w', '%{http_code}\\n', 'http://localhost:3777/api/status']);
        expect(written.stdout).toBe('200\n');
        expect(JSON.parse(fs.readFileSync(outFile, 'utf8'))).toEqual({ ok: true });
    });

    it('refuses hosts other than the local API and still logs them', () => {
        const { run, callsLog } = setup([]);
        const out = run(['-s', 'https://www.imdb.com/title/tt0111161/']);
        expect(out.status).toBe(6);
        expect(out.stdout).toBe('');
        expect(readCalls(callsLog)[0]).toMatchObject({ host: 'www.imdb.com', path: '/title/tt0111161/', status: 0, matched: false });
    });

    it('ships a wget that refuses to run', () => {
        const { binDir } = setup([]);
        const out = spawnSync(path.join(binDir, 'wget'), ['http://localhost:3777/api/status'], { encoding: 'utf8' });
        expect(out.status).not.toBe(0);
    });
});
