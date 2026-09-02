/**
 * Adapter interface — each CLI backend implements this to handle agent invocation.
 */
export interface InvokeOptions {
    agentId: string;
    message: string;
    workingDir: string;
    systemPrompt: string;
    model: string;
    shouldReset: boolean;
    envOverrides: Record<string, string>;
    onEvent?: (text: string) => void;
    /** Structured tool-use events; adapters without one keep stringifying into onEvent. */
    onTool?: (name: string, input: unknown, toolUseId?: string) => void;
    /** A tool call settled; `isError` when the tool itself reported failure. */
    onToolResult?: (toolUseId: string, isError: boolean) => void;
    /** Provider conversation id, when the stream announces one. */
    onSessionId?: (sessionId: string) => void;
    /** Fork from this provider session instead of continuing the last one. */
    resumeSessionId?: string;
}

export interface AgentAdapter {
    /** Unique provider key(s) this adapter handles (e.g. 'anthropic', 'openai'). */
    providers: string[];
    /** Execute the agent and return the response text. */
    invoke(options: InvokeOptions): Promise<string>;
}
