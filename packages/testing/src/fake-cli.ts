import fs from 'fs';
import path from 'path';

export interface FakeCliScript {
    /** Written to stdout one per line; objects are JSON-encoded. */
    lines?: (string | object)[];
    delayMs?: number;
    /** Written to stderr before any stdout line. */
    stderr?: string;
    exitCode?: number;
    /** Raised against itself after the output, instead of exiting. */
    signal?: NodeJS.Signals;
    /** Stay alive after the output until killed. */
    hang?: boolean;
}

export interface FakeCliInvocation {
    argv: string[];
    cwd: string;
}

export interface FakeCli {
    path: string;
    invocations(): FakeCliInvocation[];
}

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures');

/** The lines of `packages/testing/fixtures/<name>.jsonl`, e.g. `claude-stream` or `codex-stream`. */
export function loadRecording(name: string): string[] {
    return fs.readFileSync(path.join(FIXTURES_DIR, `${name}.jsonl`), 'utf8').split('\n').filter(line => line.trim());
}

const RUNNER = `
const fs = require('fs');
const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
fs.appendFileSync(INVOCATIONS_FILE, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }) + '\\n');
const write = (stream, text) => new Promise(resolve => stream.write(text, resolve));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
    if (config.stderr) await write(process.stderr, config.stderr);
    for (let i = 0; i < config.lines.length; i++) {
        if (i > 0 && config.delayMs) await sleep(config.delayMs);
        await write(process.stdout, config.lines[i] + '\\n');
    }
    if (config.hang) setInterval(() => {}, 1 << 30);
    else if (config.signal) process.kill(process.pid, config.signal);
    else process.exitCode = config.exitCode;
})();
`;

/**
 * Writes an executable `dir/name` that replays `script` and appends its argv
 * and cwd to a log, so a test can put `dir` first on PATH in place of a
 * provider CLI. Rewriting the same name replaces the script and keeps the log.
 */
export function writeFakeCli(dir: string, name: string, script: FakeCliScript = {}): FakeCli {
    fs.mkdirSync(dir, { recursive: true });
    const configFile = path.join(dir, `.${name}.fake.json`);
    const invocationsFile = path.join(dir, `.${name}.invocations.jsonl`);
    const bin = path.join(dir, name);

    fs.writeFileSync(configFile, JSON.stringify({
        lines: (script.lines ?? []).map(line => (typeof line === 'string' ? line : JSON.stringify(line))),
        delayMs: script.delayMs ?? 0,
        stderr: script.stderr ?? '',
        exitCode: script.exitCode ?? 0,
        signal: script.signal ?? null,
        hang: script.hang ?? false,
    }));
    const shebang = /\s/.test(process.execPath) ? '#!/usr/bin/env node' : `#!${process.execPath}`;
    fs.writeFileSync(bin, [
        shebang,
        `const CONFIG_FILE = ${JSON.stringify(configFile)};`,
        `const INVOCATIONS_FILE = ${JSON.stringify(invocationsFile)};`,
        RUNNER,
    ].join('\n'));
    fs.chmodSync(bin, 0o755);

    return {
        path: bin,
        invocations() {
            if (!fs.existsSync(invocationsFile)) return [];
            return fs.readFileSync(invocationsFile, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
        },
    };
}
