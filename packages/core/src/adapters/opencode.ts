import { AgentAdapter, InvokeOptions } from './types';
import { runCommand, runCommandStreaming } from '../invoke';
import { log } from '../logging';
import { AgentRunError } from '../agent-failure';

/**
 * Extract displayable text from an OpenCode JSONL event.
 */
function extractEventText(json: any): string | null {
    if (json.type === 'text' && json.part?.text) {
        return json.part.text;
    }
    return null;
}

/** OpenCode reports provider failures (auth, quota, funds) as an `error` event. */
function extractErrorText(json: any): string | null {
    if (json.type !== 'error') return null;
    const error = json.error;
    if (typeof error === 'string') return error;
    return error?.data?.message || error?.message || error?.name || 'OpenCode reported an error';
}

export const opencodeAdapter: AgentAdapter = {
    providers: ['opencode'],

    async invoke(opts: InvokeOptions): Promise<string> {
        const { agentId, message, workingDir, systemPrompt, model, shouldReset, envOverrides, onEvent } = opts;
        log('DEBUG', `Using OpenCode CLI (agent: ${agentId}, model: ${model})`);

        const continueConversation = !shouldReset;
        if (shouldReset) {
            log('INFO', `Resetting OpenCode conversation for agent: ${agentId}`);
        }

        // Pass system prompt via OPENCODE_CONFIG_CONTENT env var
        if (systemPrompt) {
            const configContent = JSON.stringify({
                agent: {
                    [agentId]: {
                        prompt: systemPrompt
                    }
                }
            });
            envOverrides.OPENCODE_CONFIG_CONTENT = configContent;
        }

        const args = ['run', '--format', 'json'];
        if (model) args.push('--model', model);
        if (systemPrompt) args.push('--agent', agentId);
        if (continueConversation) args.push('-c');
        args.push('--', message);

        let response = '';
        let errorText: string | null = null;
        const readLine = (line: string, onText?: (text: string) => void) => {
            let json: any;
            try { json = JSON.parse(line); } catch { return; }
            errorText = extractErrorText(json) ?? errorText;
            const text = extractEventText(json);
            if (text) {
                response = text;
                onText?.(text);
            }
        };

        try {
            if (onEvent) {
                const { promise } = runCommandStreaming('opencode', args, (line) => readLine(line, onEvent), workingDir, envOverrides, agentId);
                await promise;
            } else {
                const output = await runCommand('opencode', args, workingDir, envOverrides);
                for (const line of output.trim().split('\n')) readLine(line);
            }
        } catch (err) {
            throw new AgentRunError(errorText ?? (err as Error).message);
        }
        if (errorText && !response) throw new AgentRunError(errorText);

        return response || 'Sorry, I could not generate a response from OpenCode.';
    },
};
