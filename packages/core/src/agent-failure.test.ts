import { describe, it, expect } from 'vitest';
import { AgentRunError, classifyAgentFailure, describeAgentFailure, parseUsageLimitReset, toAgentRunError } from './agent-failure';

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
        expect(classifyAgentFailure("You've hit your 5-hour limit · resets 3pm (Europe/Madrid)")).toBe('rate_limit');
        expect(classifyAgentFailure("You've hit your usage limit. Upgrade to Plus to continue using Codex")).toBe('rate_limit');
    });

    it('recognises the watchdog stopping a silent run', () => {
        expect(classifyAgentFailure('claude produced no output for 15 minutes, so it was stopped')).toBe('stalled');
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

    it('says a stalled run was stopped and can be tried again', () => {
        const { summary, remedy } = describeAgentFailure('stalled', 'Claude', 'claude produced no output for 15 minutes, so it was stopped');
        expect(summary).toBe('Claude stopped responding, so I stopped it.');
        expect(remedy).toBe('Try again.');
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

describe('parseUsageLimitReset', () => {
    const now = new Date(2026, 9, 30, 13, 20, 0).getTime();
    const local = (month: number, day: number, h: number, m = 0, year = 2026) => new Date(year, month, day, h, m).getTime();

    it('reads the epoch seconds older Claude CLIs append to the limit message', () => {
        expect(parseUsageLimitReset('Claude AI usage limit reached|1798732800', now)).toBe(1798732800_000);
    });

    it("reads Claude's reset time in the zone it names", () => {
        const madrid = parseUsageLimitReset("You've hit your 5-hour limit · resets 3pm (Europe/Madrid)", Date.UTC(2026, 9, 30, 10, 0));
        expect(madrid).toBe(Date.UTC(2026, 9, 30, 14, 0));
        const tomorrow = parseUsageLimitReset("You've hit your 5-hour limit · resets 9:30am (America/New_York)", Date.UTC(2026, 9, 30, 20, 0));
        expect(tomorrow).toBe(Date.UTC(2026, 9, 31, 13, 30));
        const dated = parseUsageLimitReset("You've hit your weekly limit · resets Nov 3, 3pm (Europe/Madrid) · progress saved", Date.UTC(2026, 9, 30, 10, 0));
        expect(dated).toBe(Date.UTC(2026, 10, 3, 14, 0));
        const nextYear = parseUsageLimitReset("You've hit your weekly limit · resets Jan 2, 2027, 6:30pm (UTC)", Date.UTC(2026, 11, 30, 10, 0));
        expect(nextYear).toBe(Date.UTC(2027, 0, 2, 18, 30));
    });

    it("falls back to local time when Claude names no zone or one it can't resolve", () => {
        expect(parseUsageLimitReset("You've hit your 5-hour limit · resets 3pm", now)).toBe(local(9, 30, 15));
        expect(parseUsageLimitReset("You've hit your 5-hour limit · resets 3pm (Nowhere/Atlantis)", now)).toBe(local(9, 30, 15));
    });

    it("reads Codex's local try-again time, rolling a past time to tomorrow", () => {
        expect(parseUsageLimitReset("You've hit your usage limit. Upgrade to Plus to continue using Codex (https://chatgpt.com/explore/plus), or try again at 3:42 PM.", now))
            .toBe(local(9, 30, 15, 42));
        expect(parseUsageLimitReset("You've hit your usage limit. Try again at 9:05 AM.", now)).toBe(local(9, 31, 9, 5));
        expect(parseUsageLimitReset("You've hit your usage limit. Try again at Nov 2nd, 2026 4:15 PM.", now)).toBe(local(10, 2, 16, 15));
    });

    it('adds up a try-again-in duration', () => {
        expect(parseUsageLimitReset('Rate limit reached. Please try again in 20s.', now)).toBe(now + 20_000);
        expect(parseUsageLimitReset('Too many requests, try again in 2 hours 5 minutes', now)).toBe(now + 125 * 60_000);
        expect(parseUsageLimitReset('try again in 1.5 seconds', now)).toBe(now + 1_500);
    });

    it('finds nothing in text without a reset', () => {
        expect(parseUsageLimitReset('API Error: 429 rate_limit_error', now)).toBeUndefined();
        expect(parseUsageLimitReset('Overloaded', now)).toBeUndefined();
    });
});

describe('AgentRunError.resetsAt', () => {
    it('keeps a reset the adapter passes and otherwise reads one from a rate-limit message', () => {
        expect(new AgentRunError('anything', 'rate_limit', { resetsAt: 1234 }).resetsAt).toBe(1234);
        expect(new AgentRunError('Claude AI usage limit reached|1798732800').resetsAt).toBe(1798732800_000);
        expect(new AgentRunError('Claude AI usage limit reached|1798732800', 'billing').resetsAt).toBeUndefined();
        expect(new AgentRunError('API Error: 429').resetsAt).toBeUndefined();
    });
});
