/** Stand-in for a saved secret in API responses; sending it back means "keep what's stored". */
export const REDACTED = '__REDACTED__';

const SECRET_KEY_RE = /(api_key|oauth_token|token)$/i;

type Json = Record<string, unknown>;

const isPlainObject = (v: unknown): v is Json =>
    typeof v === 'object' && v !== null && !Array.isArray(v);

/** Replace non-empty secret-named string leaves with REDACTED. */
export function redactSettings<T>(node: T): T {
    if (Array.isArray(node)) return node.map(redactSettings) as T;
    if (!isPlainObject(node)) return node;
    const out: Json = {};
    for (const [key, value] of Object.entries(node)) {
        out[key] = SECRET_KEY_RE.test(key) && typeof value === 'string' && value !== ''
            ? REDACTED
            : redactSettings(value);
    }
    return out as T;
}

/** Swap REDACTED leaves for the stored value at the same path; drop them when nothing is stored. */
export function restoreRedacted<T>(node: T, stored: unknown): T {
    if (Array.isArray(node)) {
        return node.map((v, i) => restoreRedacted(v, Array.isArray(stored) ? stored[i] : undefined)) as T;
    }
    if (!isPlainObject(node)) return node;
    const from = isPlainObject(stored) ? stored : {};
    const out: Json = {};
    for (const [key, value] of Object.entries(node)) {
        if (value === REDACTED) {
            if (typeof from[key] === 'string') out[key] = from[key];
        } else {
            out[key] = restoreRedacted(value, from[key]);
        }
    }
    return out as T;
}

const CREDENTIAL_NAME = String.raw`[\w-]*(?:access[_-]?token|api[_-]?key|authorization|credential|password|secret|token)`;

/** Strip credentials from free text (CLI stderr) before it is logged, stored or sent to a chat. */
export function redactSecretText(text: string): string {
    return text
        .replace(/\b(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1')
        .replace(/\b(Bearer|Basic)\s+[^\s,;"']+/gi, '$1 [REDACTED]')
        .replace(new RegExp(`(["']${CREDENTIAL_NAME}["']\\s*:\\s*["'])[^"']*(["'])`, 'gi'), '$1[REDACTED]$2')
        .replace(new RegExp(`((?<![\\w-])${CREDENTIAL_NAME}\\b\\s*[:=]\\s*)(?:"[^"]*"|'[^']*'|[^\\s,;]+)`, 'gi'), '$1[REDACTED]')
        .replace(/\bsk-[A-Za-z0-9_-]{16,}/g, '[REDACTED]')
        .replace(/\bAIza[0-9A-Za-z_-]{30,}/g, '[REDACTED]');
}
