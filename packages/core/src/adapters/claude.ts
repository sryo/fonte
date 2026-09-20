import { AgentAdapter, InvokeOptions } from './types';
import { runCommand, runCommandStreaming } from '../invoke';
import { log } from '../logging';
import { AgentRunError, AgentFailureKind } from '../agent-failure';

const NO_RESPONSE = 'Sorry, I could not generate a response from Claude.';

// The `error` tag the CLI puts on the assistant turn it synthesises when an API call fails.
const ERROR_TURN_KINDS: Record<string, AgentFailureKind> = {
    authentication_failed: 'auth',
    oauth_org_not_allowed: 'auth',
    billing_error: 'billing',
    rate_limit: 'rate_limit',
    overloaded: 'rate_limit',
};

/**
 * Extract displayable text from a Claude stream-json event. Tool-use blocks
 * go to `onTool` when provided, else render as legacy `[tool: X]` markers.
 * Skips 'result' events — those duplicate the final assistant message.
 */
function extractEventText(
    json: any,
    onTool?: (name: string, input: unknown, toolUseId?: string) => void,
    onToolResult?: (toolUseId: string, isError: boolean) => void,
): string | null {
    if (json.type === 'assistant' && json.message?.content) {
        const parts: string[] = [];
        for (const block of json.message.content) {
            if (block.type === 'text' && block.text) {
                parts.push(block.text);
            } else if (block.type === 'tool_use' && block.name) {
                if (onTool) onTool(block.name, block.input, block.id);
                else parts.push(`[tool: ${block.name}]`);
            }
        }
        return parts.length > 0 ? parts.join('\n') : null;
    }
    // Tool results come back as user-role turns in the stream.
    if (json.type === 'user' && Array.isArray(json.message?.content) && onToolResult) {
        for (const block of json.message.content) {
            if (block.type === 'tool_result' && block.tool_use_id) onToolResult(block.tool_use_id, block.is_error === true);
        }
    }
    return null;
}

export const claudeAdapter: AgentAdapter = {
    providers: ['anthropic'],

    async invoke(opts: InvokeOptions): Promise<string> {
        const { agentId, message, workingDir, systemPrompt, model, shouldReset, envOverrides, onEvent, onTool, onToolResult, onSessionId, resumeSessionId } = opts;
        const env = { IS_SANDBOX: '1', ...envOverrides };
        log('DEBUG', `Using Claude provider (agent: ${agentId})`);

        const continueConversation = !shouldReset;
        if (shouldReset) {
            log('INFO', `Resetting conversation for agent: ${agentId}`);
        }

        const args = ['--dangerously-skip-permissions'];
        if (model) args.push('--model', model);
        if (systemPrompt) args.push('--system-prompt', systemPrompt);
        if (resumeSessionId) {
            // Forking an earlier conversation (edit-and-rerun) trumps plain continue.
            args.push('--resume', resumeSessionId);
        } else if (continueConversation) {
            args.push('-c');
        }

        if (onEvent) {
            args.push('--output-format', 'stream-json', '--verbose', '-p', message);

            let response = '';
            let resultOk = false;
            let failure = null as AgentRunError | null;
            const { promise, signalDone } = runCommandStreaming('claude', args, (line) => {
                try {
                    const json = JSON.parse(line);
                    if (json.session_id && onSessionId) onSessionId(json.session_id);
                    if (json.type === 'result') {
                        if (json.is_error === true) {
                            failure ??= new AgentRunError((typeof json.result === 'string' && json.result) || response || 'Claude reported an error');
                        } else {
                            resultOk = true;
                            if (json.result) response = json.result;
                        }
                        if (json.usage) log('INFO', `Claude usage (${agentId}): ${JSON.stringify(json.usage)}`);
                        if (json.modelUsage) log('INFO', `Claude model usage (${agentId}): ${JSON.stringify(json.modelUsage)}`);
                        signalDone();
                        return;
                    }
                    const text = extractEventText(json, onTool, onToolResult);
                    if (json.type === 'assistant' && typeof json.error === 'string') {
                        failure = new AgentRunError(text || json.error, ERROR_TURN_KINDS[json.error]);
                        return;
                    }
                    if (text) {
                        response = text;
                        onEvent(text);
                    }
                } catch (e) {
                    // Ignore non-JSON lines
                }
            }, workingDir, env, agentId);

            try {
                await promise;
            } catch (err) {
                if (resultOk) {
                    log('WARN', `Claude exited with an error after its result (agent: ${agentId}): ${(err as Error).message}`);
                    return response || NO_RESPONSE;
                }
                // Older CLIs don't tag the error turn and leave stderr empty, so
                // the last text they printed is the real error.
                throw failure ?? new AgentRunError(response || (err as Error).message);
            }
            // An error result with a clean exit and no recognisable cause (max
            // turns) still carries the partial answer.
            if (failure && failure.kind !== 'unknown') throw failure;

            return response || NO_RESPONSE;
        }

        args.push('-p', message);
        return await runCommand('claude', args, workingDir, env);
    },
};
