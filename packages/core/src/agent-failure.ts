export type AgentFailureKind = 'auth' | 'rate_limit' | 'billing' | 'unknown';

const AUTH_RE = /oauth session expired|failed to authenticate|not (?:logged in|authenticated)|invalid (?:api[ _-]?key|x-api-key|bearer token|credentials)|authentication[_ ]error|\b401\b|unauthorized|run \/login|api key (?:is )?(?:invalid|missing|required)/i;
const BILLING_RE = /credit balance|insufficient (?:funds|credits|quota)|billing|payment required|\b402\b|quota exceeded/i;
const RATE_RE = /rate[_ ]limit|\b429\b|too many requests|overloaded|usage limit|limit reached/i;

export function classifyAgentFailure(text: string): AgentFailureKind {
    if (AUTH_RE.test(text)) return 'auth';
    if (BILLING_RE.test(text)) return 'billing';
    if (RATE_RE.test(text)) return 'rate_limit';
    return 'unknown';
}

const MESSAGE_MAX = 2_000;

/** A provider CLI run that produced no answer, with the most specific text it left behind. */
export class AgentRunError extends Error {
    readonly kind: AgentFailureKind;

    constructor(message: string, kind: AgentFailureKind = classifyAgentFailure(message)) {
        super(message.slice(0, MESSAGE_MAX));
        this.name = 'AgentRunError';
        this.kind = kind;
    }
}

export function toAgentRunError(error: unknown): AgentRunError {
    if (error instanceof AgentRunError) return error;
    const message = error instanceof Error ? error.message : String(error);
    return new AgentRunError(message || 'Agent run failed');
}

const DETAIL_MAX = 240;

function excerpt(detail: string): string {
    const line = detail.split('\n').map(l => l.trim()).find(Boolean) ?? '';
    return line.length > DETAIL_MAX ? `${line.slice(0, DETAIL_MAX - 1)}…` : line;
}

/**
 * What a person reads when a run fails. `summary` goes everywhere; `remedy`
 * is the channel-only follow-up, since the dashboard renders its own action.
 */
export function describeAgentFailure(kind: AgentFailureKind, providerLabel: string, detail: string): { summary: string; remedy?: string } {
    switch (kind) {
        case 'auth': {
            const what = /expired/i.test(detail) ? 'expired' : 'was rejected';
            return {
                summary: `${providerLabel} sign-in ${what}, so I couldn't answer.`,
                remedy: 'Set a new token in the dashboard settings.',
            };
        }
        case 'rate_limit':
            return { summary: `${providerLabel} is rate limiting right now.`, remedy: 'Try again in a few minutes.' };
        case 'billing':
            return { summary: `${providerLabel} rejected the request over billing.`, remedy: "Check the account's credits." };
        default: {
            const line = excerpt(detail);
            return { summary: line ? `I couldn't finish answering. ${line}` : "I couldn't finish answering." };
        }
    }
}
