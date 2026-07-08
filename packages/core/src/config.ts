import fs from 'fs';
import path from 'path';
import { jsonrepair } from 'jsonrepair';
import { Settings, AgentConfig, TeamConfig, MODEL_ALIASES } from './types';

export const SCRIPT_DIR = path.resolve(__dirname, '../../..');
export const FONTE_HOME = process.env.FONTE_HOME
    || path.join(require('os').homedir(), '.fonte');
export const LOG_FILE = path.join(FONTE_HOME, 'logs/queue.log');
export const SETTINGS_FILE = path.join(FONTE_HOME, 'settings.json');
export const CHATS_DIR = path.join(FONTE_HOME, 'chats');
export const FILES_DIR = path.join(FONTE_HOME, 'files');

// Expected type per known settings leaf. 'record' = free-form object map.
// Validation is warn-and-continue on reads (bad tunables fall back to the
// built-in defaults) and fail-fast on writes (the API rejects type errors).
type LeafKind = 'string' | 'number' | 'boolean' | 'string[]' | 'record';
type Shape = { [key: string]: LeafKind | Shape };

const SETTINGS_SHAPE: Shape = {
    workspace: { path: 'string', name: 'string' },
    models: {
        provider: 'string',
        anthropic: { model: 'string', api_key: 'string', oauth_token: 'string' },
        openai: { model: 'string', api_key: 'string' },
        opencode: { model: 'string' },
    },
    agents: 'record',
    custom_providers: 'record',
    teams: 'record',
    monitoring: { heartbeat_interval: 'number' },
    torrent: {
        download_dir: 'string', max_concurrent: 'number', max_download_speed: 'number',
        max_upload_speed: 'number', seed_ratio_limit: 'number', auto_start: 'boolean',
        port: 'number', dht: 'boolean',
    },
    watchlist: {
        enabled: 'boolean', check_interval_minutes: 'number', auto_add: 'boolean',
        preferred_quality: 'string', jackett_url: 'string', jackett_api_key: 'string',
    },
    subtitles: {
        enabled: 'boolean', auto_download: 'boolean', translate: 'boolean',
        target_languages: 'string[]', tmdb_api_key: 'string', opensubtitles_api_key: 'string',
    },
    libraries: 'record',
    whatsapp: { allowed_chat: 'string', allowed_participants: 'string[]' },
};

function leafMatches(value: unknown, kind: LeafKind): boolean {
    switch (kind) {
        case 'string': return typeof value === 'string' || value === null;
        case 'number': return typeof value === 'number' && Number.isFinite(value);
        case 'boolean': return typeof value === 'boolean';
        case 'string[]': return Array.isArray(value) && value.every(v => typeof v === 'string');
        case 'record': return typeof value === 'object' && value !== null && !Array.isArray(value);
    }
}

/**
 * Check raw settings data against the known shape. Wrong-typed leaves become
 * typeErrors and are dropped from the returned settings (built-in defaults
 * apply); unknown keys are kept but flagged as warnings. A non-object root is
 * unrecoverable. The API write path rejects on typeErrors; reads continue.
 */
export function validateSettings(raw: unknown): { settings: Settings; warnings: string[]; typeErrors: string[] } {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        return {
            settings: {},
            warnings: [],
            typeErrors: [`settings root must be an object, got ${Array.isArray(raw) ? 'array' : typeof raw}`],
        };
    }

    const warnings: string[] = [];
    const typeErrors: string[] = [];
    const walk = (node: Record<string, unknown>, shape: Shape, prefix: string): Record<string, unknown> => {
        const out: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(node)) {
            if (value === undefined) continue;
            const spec = shape[key];
            const pathName = prefix ? `${prefix}.${key}` : key;
            if (!spec) {
                warnings.push(`unknown setting "${pathName}"`);
                out[key] = value;
            } else if (typeof spec === 'string') {
                if (leafMatches(value, spec)) {
                    out[key] = value;
                } else {
                    typeErrors.push(`"${pathName}" should be ${spec}, got ${Array.isArray(value) ? 'array' : typeof value}`);
                }
            } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                out[key] = walk(value as Record<string, unknown>, spec, pathName);
            } else {
                typeErrors.push(`"${pathName}" should be an object, got ${typeof value}`);
            }
        }
        return out;
    };

    return { settings: walk(raw as Record<string, unknown>, SETTINGS_SHAPE, '') as Settings, warnings, typeErrors };
}

let warnedSettingsOnce = false;

/** Expand ~ and $HOME prefixes in a user-supplied path. */
export function expandHomePath(input?: string): string | undefined {
    if (!input) return input;
    const home = process.env.HOME || require('os').homedir();
    if (!home) return input;
    if (input === '~') return home;
    if (input.startsWith('~/')) return path.join(home, input.slice(2));
    if (input === '$HOME') return home;
    if (input.startsWith('$HOME/')) return path.join(home, input.slice(6));
    return input;
}

export function getSettings(): Settings {
    try {
        const settingsData = fs.readFileSync(SETTINGS_FILE, 'utf8');
        let parsed: unknown;

        try {
            parsed = JSON.parse(settingsData);
        } catch (parseError) {
            console.error(`[WARN] settings.json contains invalid JSON: ${(parseError as Error).message}`);

            try {
                const repaired = jsonrepair(settingsData);
                parsed = JSON.parse(repaired);

                if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                    // jsonrepair can turn garbage into a valid non-object (e.g. a
                    // string literal) — don't overwrite the file with that.
                    console.error(`[ERROR] settings.json repaired to a non-object — leaving the file untouched`);
                    return {};
                }

                const backupPath = SETTINGS_FILE + '.bak';
                fs.copyFileSync(SETTINGS_FILE, backupPath);
                fs.writeFileSync(SETTINGS_FILE, JSON.stringify(parsed, null, 2) + '\n');
                console.error(`[WARN] Auto-fixed settings.json (backup: ${backupPath})`);
            } catch {
                console.error(`[ERROR] Could not auto-fix settings.json — returning empty config`);
                return {};
            }
        }

        const { settings, warnings, typeErrors } = validateSettings(parsed);
        if ((warnings.length || typeErrors.length) && !warnedSettingsOnce) {
            // getSettings runs on every poll — report shape problems once per process
            warnedSettingsOnce = true;
            for (const w of [...typeErrors, ...warnings]) console.error(`[WARN] settings.json: ${w}`);
        }

        if (!settings?.models?.provider) {
            if (settings?.models?.openai) {
                if (!settings.models) settings.models = {};
                settings.models.provider = 'openai';
            } else if (settings?.models?.opencode) {
                if (!settings.models) settings.models = {};
                settings.models.provider = 'opencode';
            } else if (settings?.models?.anthropic) {
                if (!settings.models) settings.models = {};
                settings.models.provider = 'anthropic';
            }
        }

        return settings;
    } catch {
        return {};
    }
}

/**
 * Startup-strength settings check: distinguishes "no settings file" (fine,
 * defaults apply) from "file exists but is unusable" (the daemon should not
 * run a torrent client on silently-defaulted paths — fail fast instead).
 */
export function checkSettingsFile(): { ok: boolean; reason?: string } {
    if (!fs.existsSync(SETTINGS_FILE)) return { ok: true };
    try {
        const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
        let parsed: unknown;
        try {
            parsed = JSON.parse(data);
        } catch {
            parsed = JSON.parse(jsonrepair(data));
        }
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            return { ok: false, reason: 'settings.json does not contain a JSON object' };
        }
        return { ok: true };
    } catch (err) {
        return { ok: false, reason: `settings.json is unreadable: ${(err as Error).message}` };
    }
}

/**
 * Build the default agent config from the legacy models section.
 * Used when no agents are configured, for backwards compatibility.
 */
export function getDefaultAgentFromModels(settings: Settings): AgentConfig {
    const provider = settings?.models?.provider || 'anthropic';
    let model = '';
    if (provider === 'openai') {
        model = settings?.models?.openai?.model || 'gpt-5.3-codex';
    } else if (provider === 'opencode') {
        model = settings?.models?.opencode?.model || 'sonnet';
    } else {
        model = settings?.models?.anthropic?.model || 'sonnet';
    }

    const workspacePath = settings?.workspace?.path || path.join(require('os').homedir(), 'fonte-workspace');
    const defaultAgentDir = path.join(workspacePath, 'fonte');

    return {
        name: 'Fonte Agent',
        provider,
        model,
        working_directory: defaultAgentDir,
    };
}

/**
 * Get all configured agents. Falls back to a single "fonte" agent
 * derived from the legacy models section if no agents are configured.
 */
export function getAgents(settings: Settings): Record<string, AgentConfig> {
    if (settings.agents && Object.keys(settings.agents).length > 0) {
        return settings.agents;
    }
    return { fonte: getDefaultAgentFromModels(settings) };
}

export function getTeams(settings: Settings): Record<string, TeamConfig> {
    return settings.teams || {};
}

/**
 * Resolve shorthand model aliases (e.g. 'sonnet' → 'claude-sonnet-4-6').
 * Unknown models pass through as-is to the CLI.
 */
export function resolveModel(model: string, provider: string): string {
    return MODEL_ALIASES[provider]?.[model] || model || '';
}
