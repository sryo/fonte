import { spawn } from 'child_process';
import { describe, it, expect } from 'vitest';
import { GROUP_WATCH_SCRIPT } from './invoke';

describe('GROUP_WATCH_SCRIPT', () => {
    it('stops the CLI when the daemon side of fd 3 goes away', async () => {
        const child = spawn('/bin/sh', ['-c', GROUP_WATCH_SCRIPT, 'fonte-agent', 'sleep', '30'], {
            stdio: ['ignore', 'ignore', 'ignore', 'pipe'],
            detached: true,
        });
        const exited = new Promise<NodeJS.Signals | null>(resolve => child.once('exit', (_code, signal) => resolve(signal)));
        await new Promise(r => setTimeout(r, 200));
        // What a crashed daemon looks like from the child's side.
        child.stdio[3]!.destroy();
        expect(await exited).toBe('SIGTERM');
        try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* watcher already gone */ }
    });
});
