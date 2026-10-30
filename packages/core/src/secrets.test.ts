import { describe, it, expect } from 'vitest';
import { redactSecretText, redactSettings, restoreRedacted, REDACTED } from './secrets';

describe('redactSettings / restoreRedacted', () => {
    it('round-trips nested secrets, including custom providers', () => {
        const stored = {
            models: { anthropic: { oauth_token: 'tok', api_key: '', model: 'opus' } },
            custom_providers: { proxy: { name: 'Proxy', api_key: 'pk', base_url: 'http://x' } },
        };
        const redacted = redactSettings(stored);
        expect(redacted.models.anthropic).toEqual({ oauth_token: REDACTED, api_key: '', model: 'opus' });
        expect(redacted.custom_providers.proxy.api_key).toBe(REDACTED);
        expect(restoreRedacted(redacted, stored)).toEqual(stored);
    });

    it('drops a placeholder with nothing stored behind it', () => {
        expect(restoreRedacted({ watchlist: { jackett_api_key: REDACTED } }, {})).toEqual({ watchlist: {} });
    });
});

describe('redactSecretText', () => {
    it('strips tokens and keys from CLI error text', () => {
        const text = [
            'API Error: 401 Authorization: Bearer sk-ant-oat01-abcdefghijklmnopqrstuv',
            '{"api_key":"AIzaSyA1234567890abcdefghijklmnopqrstu"}',
            'OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz failed',
            'fetch https://user:hunter2@proxy.example/v1 failed',
        ].join('\n');
        const out = redactSecretText(text);
        expect(out).not.toMatch(/abcdefghijklmnop|AIzaSy|hunter2/);
        expect(out).toContain('API Error: 401');
        expect(out).toContain('https://proxy.example/v1');
    });

    it('leaves ordinary failure text alone', () => {
        expect(redactSecretText('OAuth session expired and could not be refreshed')).toBe('OAuth session expired and could not be refreshed');
    });
});
