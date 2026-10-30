import { describe, expect, it } from 'vitest';
import * as core from './index';

describe('@fonte/core barrel', () => {
    it('exposes the migration helpers other packages use', () => {
        expect(typeof core.runMigrations).toBe('function');
        expect(typeof core.applyPragmas).toBe('function');
        expect(typeof core.maintainDb).toBe('function');
        expect(typeof core.maintainQueueDb).toBe('function');
    });
});
