import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { FONTE_HOME, LOG_FILE } from './config';

describe('test runs', () => {
    it('never resolve FONTE_HOME to the live install', () => {
        const live = path.join(os.homedir(), '.fonte');
        expect(path.resolve(FONTE_HOME)).not.toBe(live);
        expect(LOG_FILE.startsWith(live + path.sep)).toBe(false);
    });
});
