import fs from 'fs';
import path from 'path';
import { matchCall, type CallMatcher, type MatchableCall } from './match.ts';

export interface CurlRequest extends MatchableCall {
    url: string;
    output?: string;
    writeOut?: string;
    fail: boolean;
    include: boolean;
}

export interface CannedResponse extends CallMatcher {
    status?: number;
    json: unknown;
}

export interface RecordedCall extends MatchableCall {
    url: string;
    /** 0 when the host was refused. */
    status: number;
    matched: boolean;
}

export interface FakeCurlPaths {
    callsLog: string;
    responsesFile: string;
}

const LONG_WITH_ARG = new Set([
    'request', 'header', 'data', 'data-raw', 'data-binary', 'data-ascii', 'data-urlencode', 'json', 'url', 'url-query',
    'output', 'write-out', 'max-time', 'connect-timeout', 'user', 'user-agent', 'referer', 'cookie', 'cookie-jar',
    'form', 'form-string', 'retry', 'retry-delay', 'retry-max-time', 'proxy', 'resolve', 'cacert', 'range',
    'upload-file', 'limit-rate', 'dump-header', 'config', 'unix-socket', 'oauth2-bearer', 'max-filesize',
    'interface', 'keepalive-time', 'trace', 'trace-ascii', 'stderr', 'variable', 'expect100-timeout',
]);
const SHORT_TO_LONG: Record<string, string> = {
    X: 'request', H: 'header', d: 'data', o: 'output', w: 'write-out', m: 'max-time', u: 'user', A: 'user-agent',
    e: 'referer', b: 'cookie', c: 'cookie-jar', F: 'form', K: 'config', x: 'proxy', r: 'range', T: 'upload-file',
    D: 'dump-header', Y: 'speed-limit', y: 'speed-time', z: 'time-cond', C: 'continue-at', E: 'cert', Q: 'quote', t: 'telnet-option',
    G: 'get', I: 'head', f: 'fail', i: 'include',
};
const SHORT_WITH_ARG = new Set('XHdowmuAebcFKxrTDYyzCEQt');

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0']);

interface ParseOptions {
    readFile?: (file: string) => string;
    stdin?: () => string;
}

function urlencodeData(value: string, read: (source: string) => string): string {
    const at = value.indexOf('@');
    const eq = value.indexOf('=');
    if (at !== -1 && (eq === -1 || at < eq)) {
        const name = value.slice(0, at);
        const content = encodeURIComponent(read(value.slice(at + 1)));
        return name ? `${name}=${content}` : content;
    }
    if (eq === -1) return encodeURIComponent(value);
    const name = value.slice(0, eq);
    const content = encodeURIComponent(value.slice(eq + 1));
    return name ? `${name}=${content}` : content;
}

function parseBody(raw: string): unknown {
    try {
        return JSON.parse(raw);
    } catch {
        return raw;
    }
}

export function parseCurlArgs(argv: string[], opts: ParseOptions = {}): CurlRequest[] {
    const readFile = opts.readFile ?? ((file: string) => fs.readFileSync(file, 'utf8'));
    const read = (source: string) => (source === '-' ? (opts.stdin ?? (() => fs.readFileSync(0, 'utf8')))() : readFile(source));

    let method: string | undefined;
    let get = false;
    let head = false;
    let upload = false;
    let fail = false;
    let include = false;
    let output: string | undefined;
    let writeOut: string | undefined;
    const data: string[] = [];
    const urlQuery: string[] = [];
    const urls: string[] = [];

    const apply = (name: string, value: string | undefined) => {
        switch (name) {
            case 'request': method = value!.toUpperCase(); break;
            case 'data': case 'data-ascii':
                data.push(value!.startsWith('@') ? read(value!.slice(1)).replace(/[\r\n]/g, '') : value!);
                break;
            case 'data-binary': data.push(value!.startsWith('@') ? read(value!.slice(1)) : value!); break;
            case 'data-raw': data.push(value!); break;
            case 'json':
                data.push(value!.startsWith('@') ? read(value!.slice(1)) : value!);
                break;
            case 'data-urlencode': data.push(urlencodeData(value!, read)); break;
            case 'url-query': urlQuery.push(urlencodeData(value!, read)); break;
            case 'form': case 'form-string': data.push(value!); break;
            case 'url': urls.push(value!); break;
            case 'output': output = value; break;
            case 'write-out': writeOut = value; break;
            case 'upload-file': upload = true; break;
            case 'get': get = true; break;
            case 'head': head = true; break;
            case 'fail': case 'fail-with-body': fail = true; break;
            case 'include': include = true; break;
        }
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg.startsWith('--') && arg.length > 2) {
            const eq = arg.indexOf('=');
            const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
            if (LONG_WITH_ARG.has(name)) apply(name, eq === -1 ? argv[++i] : arg.slice(eq + 1));
            else apply(name, undefined);
        } else if (arg.startsWith('-') && arg.length > 1) {
            for (let j = 1; j < arg.length; j++) {
                const flag = arg[j];
                if (SHORT_WITH_ARG.has(flag)) {
                    const rest = arg.slice(j + 1);
                    apply(SHORT_TO_LONG[flag], rest || argv[++i]);
                    break;
                }
                if (SHORT_TO_LONG[flag]) apply(SHORT_TO_LONG[flag], undefined);
            }
        } else {
            urls.push(arg);
        }
    }

    const joined = data.length ? data.join('&') : null;
    const resolvedMethod = method
        ?? (head ? 'HEAD' : get ? 'GET' : joined !== null ? 'POST' : upload ? 'PUT' : 'GET');

    return urls.map(raw => {
        const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`);
        const query: Record<string, string> = Object.fromEntries(url.searchParams);
        const extraQuery = [...urlQuery, ...(get && joined !== null ? [joined] : [])];
        for (const part of extraQuery) Object.assign(query, Object.fromEntries(new URLSearchParams(part)));
        const body = get || joined === null ? null : parseBody(joined);
        return {
            method: resolvedMethod, url: url.href, host: url.host, path: decodeURIComponent(url.pathname),
            query, body, output, writeOut, fail, include,
        };
    });
}

export function findResponse(rules: CannedResponse[], req: MatchableCall): { status: number; json: unknown; matched: boolean } {
    const rule = rules.find(r => matchCall(r, req));
    if (!rule) return { status: 404, json: { ok: false, error: 'Not found' }, matched: false };
    return { status: rule.status ?? 200, json: rule.json, matched: true };
}

function isLocal(host: string): boolean {
    const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
    return LOCAL_HOSTS.has(name);
}

function formatWriteOut(format: string, status: number): string {
    return format
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/%\{(http_code|response_code)\}/g, String(status))
        .replace(/%\{content_type\}/g, 'application/json')
        .replace(/%\{[^}]*\}/g, '');
}

export function readCalls(callsLog: string): RecordedCall[] {
    if (!fs.existsSync(callsLog)) return [];
    return fs.readFileSync(callsLog, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
}

export function main(argv: string[], paths: FakeCurlPaths): void {
    let requests: CurlRequest[];
    try {
        requests = parseCurlArgs(argv);
    } catch (err) {
        process.stderr.write(`curl: (3) ${(err as Error).message}\n`);
        process.exitCode = 3;
        return;
    }
    if (requests.length === 0) {
        process.stderr.write('curl: no URL specified\n');
        process.exitCode = 2;
        return;
    }
    const rules: CannedResponse[] = JSON.parse(fs.readFileSync(paths.responsesFile, 'utf8'));
    let exitCode = 0;
    for (const req of requests) {
        const { method, url, host, path: reqPath, query, body } = req;
        if (!isLocal(host)) {
            fs.appendFileSync(paths.callsLog, JSON.stringify({ method, url, host, path: reqPath, query, body, status: 0, matched: false }) + '\n');
            process.stderr.write(`curl: (6) Could not resolve host: ${host.split(':')[0]}\n`);
            exitCode = 6;
            continue;
        }
        const res = findResponse(rules, req);
        fs.appendFileSync(paths.callsLog, JSON.stringify({ method, url, host, path: reqPath, query, body, status: res.status, matched: res.matched }) + '\n');
        if (req.fail && res.status >= 400) {
            process.stderr.write(`curl: (22) The requested URL returned error: ${res.status}\n`);
            exitCode = 22;
            continue;
        }
        const headers = req.include ? `HTTP/1.1 ${res.status}\r\ncontent-type: application/json\r\n\r\n` : '';
        const payload = headers + JSON.stringify(res.json);
        if (req.output && req.output !== '-') fs.writeFileSync(req.output, payload);
        else process.stdout.write(payload);
        if (req.writeOut) process.stdout.write(formatWriteOut(req.writeOut, res.status));
    }
    process.exitCode = exitCode;
}

/** Writes `binDir/curl` (this module, logging to `paths`) and a `wget` that refuses, for a PATH prefix. */
export function writeFakeCurl(binDir: string, paths: FakeCurlPaths): string {
    fs.mkdirSync(binDir, { recursive: true });
    const shebang = /\s/.test(process.execPath) ? '#!/usr/bin/env node' : `#!${process.execPath}`;
    const moduleUrl = new URL('./fake-curl.ts', import.meta.url).href;
    const curl = path.join(binDir, 'curl');
    fs.writeFileSync(curl, [
        shebang,
        `import(${JSON.stringify(moduleUrl)}).then(`,
        `    m => m.main(process.argv.slice(2), ${JSON.stringify(paths)}),`,
        `    err => { process.stderr.write('curl: ' + err.message + '\\n'); process.exit(2); },`,
        ');',
        '',
    ].join('\n'), { mode: 0o755 });
    fs.writeFileSync(path.join(binDir, 'wget'), '#!/bin/sh\necho "wget: command not found" >&2\nexit 127\n', { mode: 0o755 });
    return curl;
}
