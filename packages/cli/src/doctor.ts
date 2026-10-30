/**
 * Read-only health check of the local install.
 */

import os from 'os';
import path from 'path';
import { FONTE_HOME, SCRIPT_DIR } from '@fonte/core';
import { API_URL } from './shared.ts';
import { type DoctorContext, formatReport, runChecks, sqliteIntegrity, whichOnPath } from './doctor-checks.ts';

const args = process.argv.slice(2);
const json = args.includes('--json');

const ctx: DoctorContext = {
    fonteHome: FONTE_HOME,
    homeDir: os.homedir(),
    repoRoot: SCRIPT_DIR,
    launchAgentsDir: path.join(os.homedir(), 'Library', 'LaunchAgents'),
    platform: process.platform,
    env: process.env,
    apiUrl: API_URL,
    transmissionUrl: 'http://127.0.0.1:9091/transmission/rpc',
    timeoutMs: 2000,
    logSizeLimitBytes: 100 * 1024 * 1024,
    now: () => Date.now(),
    fetch: globalThis.fetch,
    which: whichOnPath,
    checkSqlite: sqliteIntegrity,
};

const results = await runChecks(ctx);

if (json) {
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
} else {
    const color = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
    process.stdout.write(`\n${formatReport(results, { color })}\n\n`);
}

process.exit(results.some(r => r.status === 'fail') ? 1 : 0);
