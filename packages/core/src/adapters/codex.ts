import { AgentAdapter, InvokeOptions } from './types';
import { runCommand, runCommandStreaming } from '../invoke';
import { log } from '../logging';
import { AgentRunError } from '../agent-failure';

/**
 * Extract displayable text from a Codex JSONL event.
 */
function extractEventText(json: any): string | null {
    if (json.type === 'item.completed' && json.item?.type === 'agent_message') {
        return json.item.text || null;
    }
    return null;
}

/** Message of an `error` or `turn.failed` event, the only place Codex says why a turn died. */
function extractErrorText(json: any): string | null {
    if (json.type === 'error' && typeof json.message === 'string') return json.message;
    if (json.type === 'turn.failed') return json.error?.message || 'Codex turn failed';
    return null;
}

export const codexAdapter: AgentAdapter = {
    providers: ['openai'],

    async invoke(opts: InvokeOptions): Promise<string> {
        const { agentId, message, workingDir, systemPrompt, model, shouldReset, envOverrides, onEvent } = opts;
        log('DEBUG', `Using Codex CLI (agent: ${agentId})`);

        const args = ['exec'];
        if (shouldReset) {
            log('INFO', `Resetting Codex conversation for agent: ${agentId}`);
        } else {
            args.push('resume', '--last');
        }
        if (model) args.push('--model', model);
        if (systemPrompt) args.push('-c', `developer_instructions=${systemPrompt}`);
        args.push('--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '--json', '--', message);

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
                const { promise } = runCommandStreaming('codex', args, (line) => readLine(line, onEvent), workingDir, envOverrides, agentId);
                await promise;
            } else {
                const output = await runCommand('codex', args, workingDir, envOverrides);
                for (const line of output.trim().split('\n')) readLine(line);
            }
        } catch (err) {
            throw new AgentRunError(errorText ?? (err as Error).message);
        }
        if (errorText && !response) throw new AgentRunError(errorText);

        return response || 'Sorry, I could not generate a response from Codex.';
    },
};
