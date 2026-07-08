import { AgentAdapter, InvokeOptions } from './types';
import { runCommandStreaming } from '../invoke';
import { log } from '../logging';

/**
 * Extract displayable text from a Gemini CLI JSON event.
 */
function extractEventText(json: any): string | null {
    if (json.type === 'response' && json.response) {
        return json.response;
    }
    if (json.type === 'text' && json.text) {
        return json.text;
    }
    if (json.content) {
        return typeof json.content === 'string' ? json.content : null;
    }
    return null;
}

export const geminiAdapter: AgentAdapter = {
    providers: ['gemini'],

    async invoke(opts: InvokeOptions): Promise<string> {
        const { agentId, message, workingDir, systemPrompt, model, shouldReset, envOverrides, onEvent } = opts;
        log('DEBUG', `Using Gemini CLI (agent: ${agentId})`);

        const args = ['-p', message];
        if (model) args.push('--model', model);
        if (systemPrompt) args.push('--system-instruction', systemPrompt);
        args.push('--output-format', 'json');
        args.push('--sandbox');

        const env: Record<string, string> = {
            ...envOverrides,
            HOME: process.env.HOME || '',
            PATH: process.env.PATH || '',
        };

        if (envOverrides.GOOGLE_API_KEY) {
            env.GOOGLE_API_KEY = envOverrides.GOOGLE_API_KEY;
        }

        const cmd = 'gemini';

        if (onEvent) {
            const { promise } = runCommandStreaming(cmd, args, (line: string) => {
                try {
                    const json = JSON.parse(line);
                    const text = extractEventText(json);
                    if (text) onEvent(text);
                } catch {
                    if (line.trim()) onEvent(line);
                }
            }, workingDir, env);
            const output = await promise;

            try {
                const parsed = JSON.parse(output);
                return parsed.response || parsed.text || output;
            } catch {
                return output;
            }
        } else {
            const { runCommand } = await import('../invoke');
            const output = await runCommand(cmd, args, workingDir, env);

            try {
                const parsed = JSON.parse(output);
                return parsed.response || parsed.text || output;
            } catch {
                return output;
            }
        }
    },
};
