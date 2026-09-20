import { describe, it, expect } from 'vitest';
import { AgentRunError, classifyAgentFailure, describeAgentFailure, toAgentRunError } from './agent-failure';

describe('classifyAgentFailure', () => {
    it('recognises the Claude CLI auth line and API auth errors', () => {
        expect(classifyAgentFailure('Failed to authenticate: OAuth session expired and could not be refreshed')).toBe('auth');
        expect(classifyAgentFailure('API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}')).toBe('auth');
        expect(classifyAgentFailure('Not logged in. Please run /login')).toBe('auth');
    });

    it('separates billing and rate limits from auth', () => {
        expect(classifyAgentFailure('Your credit balance is too low to access the Anthropic API')).toBe('billing');
        expect(classifyAgentFailure('API Error: 429 rate_limit_error')).toBe('rate_limit');
        expect(classifyAgentFailure('Overloaded')).toBe('rate_limit');
    });

    it('leaves everything else unknown', () => {
        expect(classifyAgentFailure('Command exited with code 1')).toBe('unknown');
        expect(classifyAgentFailure('')).toBe('unknown');
    });
});

describe('describeAgentFailure', () => {
    it('says what happened and, for channels, what to do', () => {
        const expired = describeAgentFailure('auth', 'Claude', 'OAuth session expired and could not be refreshed');
        expect(expired.summary).toBe("Claude sign-in expired, so I couldn't answer.");
        expect(expired.remedy).toBe('Set a new token in the dashboard settings.');

        const rejected = describeAgentFailure('auth', 'Claude', 'invalid x-api-key');
        expect(rejected.summary).toBe("Claude sign-in was rejected, so I couldn't answer.");
    });

    it('keeps the first line of an unknown error, trimmed', () => {
        const { summary, remedy } = describeAgentFailure('unknown', 'Claude', '\n  spawn claude ENOENT\n    at ChildProcess._handle.onexit');
        expect(summary).toBe("I couldn't finish answering. spawn claude ENOENT");
        expect(remedy).toBeUndefined();
        expect(describeAgentFailure('unknown', 'Claude', 'x'.repeat(500)).summary.length).toBeLessThan(300);
    });
});

describe('toAgentRunError', () => {
    it('classifies plain errors and passes AgentRunError through untouched', () => {
        const wrapped = toAgentRunError(new Error('Failed to authenticate: OAuth session expired'));
        expect(wrapped).toBeInstanceOf(AgentRunError);
        expect(wrapped.kind).toBe('auth');

        const original = new AgentRunError('anything', 'billing');
        expect(toAgentRunError(original)).toBe(original);
        expect(toAgentRunError('boom').message).toBe('boom');
        expect(new AgentRunError('401 ' + 'x'.repeat(5000)).message.length).toBe(2000);
        expect(new AgentRunError('x'.repeat(5000) + ' 401').kind).toBe('auth');
    });
});
