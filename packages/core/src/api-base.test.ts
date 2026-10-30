import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiBaseUrl, apiPort } from './config';

describe('API address', () => {
    afterEach(() => vi.unstubAllEnvs());

    it('defaults to 3777 on localhost', () => {
        vi.stubEnv('FONTE_API_PORT', '');
        expect(apiPort()).toBe(3777);
        expect(apiBaseUrl()).toBe('http://localhost:3777');
    });

    it('follows FONTE_API_PORT', () => {
        vi.stubEnv('FONTE_API_PORT', '3901');
        expect(apiPort()).toBe(3901);
        expect(apiBaseUrl()).toBe('http://localhost:3901');
    });
});
