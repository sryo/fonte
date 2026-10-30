import { describe, it, expect } from 'vitest';
import {
    AgentSessionStore, StoredAgentSession, isMissingSessionError, runInAgentSession, sessionLane,
} from './agent-session';
import { AgentRunError } from './agent-failure';
import { MessageLane } from './types';

function memoryStore(initial: Record<string, StoredAgentSession> = {}): AgentSessionStore & { rows: Map<string, StoredAgentSession> } {
    const rows = new Map(Object.entries(initial));
    return {
        rows,
        get: (agentId, lane) => rows.get(`${agentId}/${lane}`) ?? null,
        set: (agentId, lane, provider, sessionId) => { rows.set(`${agentId}/${lane}`, { provider, sessionId }); },
        clear: (agentId, lane) => {
            for (const key of [...rows.keys()]) {
                if (lane ? key === `${agentId}/${lane}` : key.startsWith(`${agentId}/`)) rows.delete(key);
            }
        },
    };
}

type Call = { resume: string | undefined };

function fakeRun(outcomes: Array<{ session?: string; error?: unknown; value?: string }>) {
    const calls: Call[] = [];
    const run = async (resume: string | undefined, onSessionId: (id: string) => void) => {
        const outcome = outcomes[calls.length] ?? { value: 'ok' };
        calls.push({ resume });
        if (outcome.session) onSessionId(outcome.session);
        if (outcome.error !== undefined) throw outcome.error;
        return outcome.value ?? 'ok';
    };
    return { calls, run };
}

const base = (store: AgentSessionStore, lane: MessageLane = 'user') => ({
    agentId: 'a', lane, provider: 'anthropic', reset: false, store,
});

describe('runInAgentSession', () => {
    it('runs a fresh-session message in a new conversation and leaves the lane alone', async () => {
        const store = memoryStore({ 'a/user': { provider: 'anthropic', sessionId: 'chat' } });
        const { calls, run } = fakeRun([{ session: 'one-off' }]);
        const outcome = await runInAgentSession({ ...base(store), fresh: true, run });
        expect(calls).toEqual([{ resume: undefined }]);
        expect(outcome.sessionId).toBe('one-off');
        expect(store.get('a', 'user')).toEqual({ provider: 'anthropic', sessionId: 'chat' });
    });

    it('starts a new conversation when nothing is stored, then remembers it', async () => {
        const store = memoryStore();
        const { calls, run } = fakeRun([{ session: 's1', value: 'hello' }]);
        const outcome = await runInAgentSession({ ...base(store), run });
        expect(calls).toEqual([{ resume: undefined }]);
        expect(outcome).toEqual({ ok: true, value: 'hello', sessionId: 's1' });
        expect(store.get('a', 'user')).toEqual({ provider: 'anthropic', sessionId: 's1' });
    });

    it('resumes the stored session of its own lane only', async () => {
        const store = memoryStore({
            'a/user': { provider: 'anthropic', sessionId: 'chat' },
            'a/background': { provider: 'anthropic', sessionId: 'auto' },
        });
        const user = fakeRun([{ session: 'chat' }]);
        await runInAgentSession({ ...base(store, 'user'), run: user.run });
        const background = fakeRun([{ session: 'auto-2' }]);
        await runInAgentSession({ ...base(store, 'background'), run: background.run });

        expect(user.calls).toEqual([{ resume: 'chat' }]);
        expect(background.calls).toEqual([{ resume: 'auto' }]);
        expect(store.get('a', 'user')?.sessionId).toBe('chat');
        expect(store.get('a', 'background')?.sessionId).toBe('auto-2');
    });

    it('gives a background run its own conversation even when the user lane has one', async () => {
        const store = memoryStore({ 'a/user': { provider: 'anthropic', sessionId: 'chat' } });
        const { calls, run } = fakeRun([{ session: 'auto' }]);
        await runInAgentSession({ ...base(store, 'background'), run });
        expect(calls).toEqual([{ resume: undefined }]);
        expect(store.get('a', 'user')?.sessionId).toBe('chat');
        expect(store.get('a', 'background')?.sessionId).toBe('auto');
    });

    it('never resumes a session another provider recorded', async () => {
        const store = memoryStore({ 'a/user': { provider: 'anthropic', sessionId: 'claude-id' } });
        const { calls, run } = fakeRun([{ session: 'thread-1' }]);
        await runInAgentSession({ ...base(store), provider: 'openai', run });
        expect(calls).toEqual([{ resume: undefined }]);
        expect(store.get('a', 'user')).toEqual({ provider: 'openai', sessionId: 'thread-1' });
    });

    it('lets an explicit fork win over the stored session and keeps the fork afterwards', async () => {
        const store = memoryStore({ 'a/user': { provider: 'anthropic', sessionId: 'chat' } });
        const { calls, run } = fakeRun([{ session: 'forked' }]);
        await runInAgentSession({ ...base(store), explicitSessionId: 'earlier', run });
        expect(calls).toEqual([{ resume: 'earlier' }]);
        expect(store.get('a', 'user')?.sessionId).toBe('forked');
    });

    it('clears both lanes on reset and starts fresh', async () => {
        const store = memoryStore({
            'a/user': { provider: 'anthropic', sessionId: 'chat' },
            'a/background': { provider: 'anthropic', sessionId: 'auto' },
            'b/user': { provider: 'anthropic', sessionId: 'other' },
        });
        const { calls, run } = fakeRun([{ session: 'new' }]);
        await runInAgentSession({ ...base(store), reset: true, run });
        expect(calls).toEqual([{ resume: undefined }]);
        expect(store.get('a', 'user')?.sessionId).toBe('new');
        expect(store.get('a', 'background')).toBeNull();
        expect(store.get('b', 'user')?.sessionId).toBe('other');
    });

    it('records the session of a failed run, since the provider already holds that turn', async () => {
        const store = memoryStore({ 'a/user': { provider: 'anthropic', sessionId: 'chat' } });
        const error = new AgentRunError('Rate limited', 'rate_limit');
        const { run } = fakeRun([{ session: 'chat-2', error }]);
        const outcome = await runInAgentSession({ ...base(store), run });
        expect(outcome).toEqual({ ok: false, error, sessionId: 'chat-2' });
        expect(store.get('a', 'user')?.sessionId).toBe('chat-2');
    });

    it('keeps the stored session when a failed run never announced one', async () => {
        const store = memoryStore({ 'a/user': { provider: 'anthropic', sessionId: 'chat' } });
        const { calls, run } = fakeRun([{ error: new AgentRunError('Failed to authenticate', 'auth') }]);
        const outcome = await runInAgentSession({ ...base(store), run });
        expect(outcome.ok).toBe(false);
        expect(calls).toHaveLength(1);
        expect(store.get('a', 'user')?.sessionId).toBe('chat');
    });

    it('drops a stored session the provider no longer has and retries once fresh', async () => {
        const store = memoryStore({ 'a/user': { provider: 'anthropic', sessionId: 'gone' } });
        const { calls, run } = fakeRun([
            { error: new AgentRunError('No conversation found with session ID: gone') },
            { session: 'fresh', value: 'answer' },
        ]);
        const outcome = await runInAgentSession({ ...base(store), run });
        expect(calls).toEqual([{ resume: 'gone' }, { resume: undefined }]);
        expect(outcome).toEqual({ ok: true, value: 'answer', sessionId: 'fresh' });
        expect(store.get('a', 'user')?.sessionId).toBe('fresh');
    });

    it('falls back to a fresh conversation when an explicit fork is gone', async () => {
        const store = memoryStore();
        const { calls, run } = fakeRun([
            { error: new AgentRunError('No conversation found with session ID: earlier') },
            { session: 'fresh' },
        ]);
        const outcome = await runInAgentSession({ ...base(store), explicitSessionId: 'earlier', run });
        expect(calls).toEqual([{ resume: 'earlier' }, { resume: undefined }]);
        expect(outcome.ok).toBe(true);
    });

    it('retries at most once and leaves the lane empty when the fresh run also fails', async () => {
        const store = memoryStore({ 'a/user': { provider: 'anthropic', sessionId: 'gone' } });
        const second = new AgentRunError('Session not found');
        const { calls, run } = fakeRun([{ error: new AgentRunError('No conversation found with session ID: gone') }, { error: second }]);
        const outcome = await runInAgentSession({ ...base(store), run });
        expect(calls).toHaveLength(2);
        expect(outcome).toEqual({ ok: false, error: second, sessionId: null });
        expect(store.get('a', 'user')).toBeNull();
    });

    it('does not retry an unrelated failure of a resumed run', async () => {
        const store = memoryStore({ 'a/user': { provider: 'anthropic', sessionId: 'chat' } });
        const { calls, run } = fakeRun([{ error: new Error('claude was killed by SIGTERM') }]);
        await runInAgentSession({ ...base(store), run });
        expect(calls).toHaveLength(1);
        expect(store.get('a', 'user')?.sessionId).toBe('chat');
    });
});

describe('isMissingSessionError', () => {
    it.each([
        'No conversation found with session ID: 5f0c2a8e-1d7b-4c39-9a51-0b6e7f3d2c11',
        'Error: no rollout found for thread id 0199d1e2-7c4b-7a10-8f3e-5b2a9c6d4e11',
        'Session not found',
        'thread not found: 0199d1e2',
    ])('recognises %s', (text) => {
        expect(isMissingSessionError(new AgentRunError(text))).toBe(true);
    });

    it.each([
        'Failed to authenticate',
        'Rate limited',
        'WhatsApp session not connected',
    ])('ignores %s', (text) => {
        expect(isMissingSessionError(new Error(text))).toBe(false);
    });
});

describe('sessionLane', () => {
    it('maps background rows to their lane and everything else to user', () => {
        expect(sessionLane('background')).toBe('background');
        expect(sessionLane('user')).toBe('user');
        expect(sessionLane(undefined)).toBe('user');
    });
});
