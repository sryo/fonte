import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { Hono } from 'hono';
import { FONTE_HOME, log } from '@fonte/core';
import { ok, fail } from '../http';

export interface ServiceHandlers {
    restart?: () => void;
}

/**
 * Spawn a detached replacement of the current daemon process, mirroring how
 * `fonte start` launches it (detached node, output appended to daemon.log).
 * The `sleep 1; exec` shell wrapper lets the old process fully exit — and
 * release the API port — before the replacement boots. The new daemon writes
 * its own PID into fonte.pid at startup, so the CLI tracks it seamlessly.
 */
function respawnDaemon(): void {
    const script = process.argv[1];
    const logDir = path.join(FONTE_HOME, 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const out = fs.openSync(path.join(logDir, 'daemon.log'), 'a');

    const child = spawn('/bin/sh', ['-c', 'sleep 1; exec "$1" "$2"', 'fonte-respawn', process.execPath, script], {
        detached: true,
        stdio: ['ignore', out, out],
        env: { ...process.env },
    });
    child.unref();
    log('INFO', `[API] Respawning daemon (PID: ${child.pid})`);
}

export function createServicesRoutes(handlers?: ServiceHandlers): Hono {
    const app = new Hono();

    // POST /api/services/restart — restart the daemon.
    //
    // Two environments, two mechanisms:
    // - Container (PID 1): the Docker entrypoint loop respawns us when we
    //   exit with code 75, so just trigger the graceful shutdown.
    // - Standalone (launchd one-shot plist / `fonte start`): nothing watches
    //   our exit code, so exiting alone would kill the daemon dead. Spawn a
    //   detached replacement first, then shut down gracefully.
    app.post('/api/services/restart', (c) => {
        if (!handlers?.restart) {
            return fail(c, 'Restart not available', 501);
        }

        const container = process.pid === 1;
        // Respond before exiting so the client gets a response
        const response = ok(c, { action: container ? 'restart' : 'respawn' });
        setTimeout(() => {
            if (!container) respawnDaemon();
            handlers!.restart!();
        }, 100);
        return response;
    });

    return app;
}
