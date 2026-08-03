import { execFile } from 'child_process';

/**
 * Reveal a path in a Finder window via `open -R`. Argv array, never shell
 * interpolation — paths come from torrent metadata. Unlike notifications this
 * rejects on failure so API routes can surface the error to the caller.
 * Callers gate on process.platform; `open -R` needs no automation prompt.
 */
export function revealInFinder(absPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        execFile('/usr/bin/open', ['-R', absPath], (err) => {
            if (err) reject(new Error(`Reveal failed: ${err.message}`));
            else resolve();
        });
    });
}
