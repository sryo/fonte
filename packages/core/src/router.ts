import path from 'path';
import { AgentConfig } from './types';

/**
 * Parse @agent_id prefix from a message.
 * Returns { agentId, message } where message has the prefix stripped.
 */
export function parseAgentRouting(
    rawMessage: string,
    agents: Record<string, AgentConfig>,
): { agentId: string; message: string } {
    const match = rawMessage.match(/^@(\S+)\s+([\s\S]*)$/);
    if (match) {
        const candidateId = match[1].toLowerCase();
        const message = match[2];

        if (agents[candidateId]) {
            return { agentId: candidateId, message };
        }

        for (const [id, config] of Object.entries(agents)) {
            if (config.name.toLowerCase() === candidateId) {
                return { agentId: id, message };
            }
        }
    }
    return { agentId: 'fonte', message: rawMessage };
}

export function getAgentResetFlag(agentId: string, workspacePath: string): string {
    return path.join(workspacePath, agentId, 'reset_flag');
}
