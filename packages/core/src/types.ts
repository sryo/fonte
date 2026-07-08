export interface CustomProvider {
    name: string;
    harness: 'claude' | 'codex';  // which CLI to invoke
    base_url: string;
    api_key: string;
    model?: string;               // model name to pass to the CLI
}

export interface AgentConfig {
    name: string;
    provider: string;       // 'anthropic', 'openai', 'opencode', or 'custom:<provider_id>'
    model: string;           // e.g. 'sonnet', 'opus', 'gpt-5.3-codex'
    working_directory: string;
    system_prompt?: string;
    prompt_file?: string;
    heartbeat?: {
        enabled?: boolean;
        interval?: number;
    };
}

export interface TeamConfig {
    name: string;
    agents: string[];
    leader_agent: string;
}

export interface Settings {
    workspace?: {
        path?: string;
        name?: string;
    };
    models?: {
        provider?: string; // 'anthropic', 'openai', or 'opencode'
        anthropic?: {
            model?: string;
            api_key?: string;
            oauth_token?: string;
        };
        openai?: {
            model?: string;
            api_key?: string;
        };
        opencode?: {
            model?: string;
        };
    };
    agents?: Record<string, AgentConfig>;
    custom_providers?: Record<string, CustomProvider>;
    teams?: Record<string, TeamConfig>;
    monitoring?: {
        heartbeat_interval?: number;
    };
    torrent?: {
        download_dir?: string;
        max_concurrent?: number;
        max_download_speed?: number;
        max_upload_speed?: number;
        seed_ratio_limit?: number;
        auto_start?: boolean;
        port?: number;
        dht?: boolean;
    };
    watchlist?: {
        enabled?: boolean;
        check_interval_minutes?: number;
        auto_add?: boolean;
        preferred_quality?: string;
        jackett_url?: string;
        jackett_api_key?: string;
    };
    subtitles?: {
        enabled?: boolean;
        auto_download?: boolean;
        translate?: boolean;
        target_languages?: string[];
        tmdb_api_key?: string;
        opensubtitles_api_key?: string;
    };
    libraries?: Record<string, string>;  // type → folder path, e.g. { "Movies": "/media/Movies", "TV": "/media/TV", "Music": "/media/Music" }
    whatsapp?: {
        allowed_chat?: string | null;  // chat id (e.g. "1234567890@c.us" or "1234567890-1500000000@g.us"). null/missing = ignore all
        allowed_participants?: string[];  // sender jids allowed to command beyond the paired account; empty = only you (fromMe)
    };
}

export interface MessageData {
    channel: string;
    sender: string;
    senderId?: string;
    message: string;
    timestamp: number;
    messageId: string;
    agent?: string; // optional: pre-routed agent id from channel client
    fromAgent?: string; // which agent sent this internal message
}

export interface ResponseData {
    channel: string;
    sender: string;
    message: string;
    originalMessage: string;
    timestamp: number;
    messageId: string;
    agent?: string; // which agent handled this
    files?: string[];
    metadata?: Record<string, unknown>;
}

// Shorthand model aliases — everything else passes through as-is to the CLI.
export const MODEL_ALIASES: Record<string, Record<string, string>> = {
    anthropic: {
        'sonnet': 'claude-sonnet-4-6',
        'opus': 'claude-opus-4-6',
    },
    openai: {},
    opencode: {
        'sonnet': 'opencode/claude-sonnet-4-6',
        'opus': 'opencode/claude-opus-4-6',
    },
    gemini: {
        'pro': 'gemini-2.5-pro',
        'flash': 'gemini-2.5-flash',
    },
};

// Schedule types
export interface Schedule {
    id: string;
    label: string;
    cron: string;           // 5-field cron expression (empty for one-time)
    agentId: string;
    message: string;
    channel: string;        // default "schedule"
    sender: string;         // default "Scheduler"
    enabled: boolean;
    createdAt: number;      // epoch ms
    runAt?: string;         // ISO date string for one-time schedules
}

// Queue job data types
export interface MessageJobData {
    channel: string;
    sender: string;
    senderId?: string;
    message: string;
    messageId: string;
    agent?: string;
    fromAgent?: string;
}

export interface ResponseJobData {
    channel: string;
    sender: string;
    senderId?: string;
    message: string;
    originalMessage: string;
    messageId: string;
    agent?: string;
    files?: string[];
    metadata?: Record<string, unknown>;
}
