import { log } from './logging';
import { MessageLane } from './types';

export interface StoredAgentSession {
    provider: string;
    sessionId: string;
}

export interface AgentSessionStore {
    get(agentId: string, lane: MessageLane): StoredAgentSession | null;
    set(agentId: string, lane: MessageLane, provider: string, sessionId: string): void;
    /** Without a lane, clears every lane of the agent. */
    clear(agentId: string, lane?: MessageLane): unknown;
}

export type AgentSessionRun<T> =
    | { ok: true; value: T; sessionId: string | null }
    | { ok: false; error: unknown; sessionId: string | null };

const MISSING_SESSION_RE = /no conversation found|no (?:saved )?session found|no rollout found|^\s*(?:error:\s*)?session not found|(?:thread|conversation) not found/i;

export function isMissingSessionError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error ?? '');
    return MISSING_SESSION_RE.test(message);
}

export function sessionLane(lane: unknown): MessageLane {
    return lane === 'background' ? 'background' : 'user';
}

/**
 * Runs one agent turn in the provider conversation kept for its agent and
 * lane. An explicit session (edit-and-rerun) wins over the stored one, a reset
 * drops every lane first, and a session the provider no longer has is dropped
 * and the turn retried once in a new conversation. Whatever session the run
 * announces becomes the lane's session, even when the run then fails, because
 * the provider has already recorded that turn.
 */
export async function runInAgentSession<T>(opts: {
    agentId: string;
    lane: MessageLane;
    provider: string;
    explicitSessionId?: string | null;
    /** A one-off conversation: nothing is resumed and the lane keeps its session. */
    fresh?: boolean;
    reset: boolean;
    store: AgentSessionStore;
    run: (resumeSessionId: string | undefined, onSessionId: (sessionId: string) => void) => Promise<T>;
}): Promise<AgentSessionRun<T>> {
    const { agentId, lane, provider, store } = opts;
    if (opts.reset) {
        log('INFO', `Resetting conversations for agent: ${agentId}`);
        store.clear(agentId);
    }
    const stored = opts.fresh ? null : store.get(agentId, lane);
    const resume = opts.explicitSessionId || (stored?.provider === provider ? stored.sessionId : undefined);

    const attempt = async (resumeSessionId: string | undefined): Promise<AgentSessionRun<T>> => {
        let sessionId: string | null = null;
        try {
            const value = await opts.run(resumeSessionId, (id) => { sessionId = id; });
            return { ok: true, value, sessionId };
        } catch (error) {
            return { ok: false, error, sessionId };
        } finally {
            if (sessionId && !opts.fresh) store.set(agentId, lane, provider, sessionId);
        }
    };

    const first = await attempt(resume);
    if (first.ok || !resume || first.sessionId || !isMissingSessionError(first.error)) return first;

    log('WARN', `Session ${resume} of agent ${agentId} (${lane}) no longer exists; starting a new conversation`);
    store.clear(agentId, lane);
    return attempt(undefined);
}
