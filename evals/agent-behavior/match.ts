/**
 * Matchers shared by canned responses and assertions. A literal matches by
 * value (primitives loosely, so 5 matches "5"), a plain object matches any
 * object holding at least those keys, and an object of `$` operators tests
 * the value: `$regex` (+ `$flags`; objects are tested as JSON), `$exists`,
 * `$in` and `$not`.
 */
export type ValueMatcher = unknown;

export interface CallMatcher {
    method?: ValueMatcher;
    host?: ValueMatcher;
    /** A string is a route pattern (`/api/torrents/:id`, trailing `*`); anything else is a value matcher. */
    path?: ValueMatcher;
    query?: ValueMatcher;
    body?: ValueMatcher;
}

export interface MatchableCall {
    method: string;
    host: string;
    path: string;
    query: Record<string, string>;
    body: unknown;
}

const OPERATORS = new Set(['$regex', '$flags', '$exists', '$in', '$not']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOperatorObject(value: Record<string, unknown>): boolean {
    const keys = Object.keys(value);
    return keys.length > 0 && keys.every(k => OPERATORS.has(k));
}

export function matchValue(expected: ValueMatcher, actual: unknown): boolean {
    if (expected === null || expected === undefined) return actual === null || actual === undefined;
    if (typeof expected !== 'object') {
        if (actual === null || actual === undefined || typeof actual === 'object') return false;
        return String(actual) === String(expected);
    }
    if (Array.isArray(expected)) {
        return Array.isArray(actual) && actual.length === expected.length && expected.every((e, i) => matchValue(e, actual[i]));
    }
    const exp = expected as Record<string, unknown>;
    if (isOperatorObject(exp)) {
        if ('$exists' in exp && (actual !== undefined) !== Boolean(exp.$exists)) return false;
        if ('$regex' in exp) {
            if (actual === undefined || actual === null) return false;
            const text = typeof actual === 'object' ? JSON.stringify(actual) : String(actual);
            if (!new RegExp(String(exp.$regex), typeof exp.$flags === 'string' ? exp.$flags : '').test(text)) return false;
        }
        if ('$in' in exp && !(Array.isArray(exp.$in) && exp.$in.some(e => matchValue(e, actual)))) return false;
        if ('$not' in exp && matchValue(exp.$not, actual)) return false;
        return true;
    }
    if (!isPlainObject(actual)) return false;
    return Object.entries(exp).every(([key, value]) => matchValue(value, actual[key]));
}

export function matchPath(pattern: string, actual: string): boolean {
    const trim = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p);
    const want = trim(pattern).split('/');
    const got = trim(actual).split('/');
    for (let i = 0; i < want.length; i++) {
        if (want[i] === '*' && i === want.length - 1) return true;
        if (i >= got.length) return false;
        if (want[i].startsWith(':')) {
            if (!got[i]) return false;
            continue;
        }
        if (want[i] !== got[i]) return false;
    }
    return want.length === got.length;
}

export function matchCall(matcher: CallMatcher, call: MatchableCall): boolean {
    if (matcher.method !== undefined) {
        const method = typeof matcher.method === 'string' ? matcher.method.toUpperCase() : matcher.method;
        if (!matchValue(method, call.method)) return false;
    }
    if (matcher.host !== undefined && !matchValue(matcher.host, call.host)) return false;
    if (matcher.path !== undefined) {
        const ok = typeof matcher.path === 'string' ? matchPath(matcher.path, call.path) : matchValue(matcher.path, call.path);
        if (!ok) return false;
    }
    if (matcher.query !== undefined && !matchValue(matcher.query, call.query)) return false;
    if (matcher.body !== undefined && !matchValue(matcher.body, call.body)) return false;
    return true;
}

export function describeMatcher(matcher: CallMatcher): string {
    const method = typeof matcher.method === 'string' ? matcher.method.toUpperCase() : matcher.method === undefined ? 'any method' : JSON.stringify(matcher.method);
    const p = typeof matcher.path === 'string' ? matcher.path : matcher.path === undefined ? 'any path' : JSON.stringify(matcher.path);
    const extras = [
        matcher.query !== undefined ? `query ${JSON.stringify(matcher.query)}` : '',
        matcher.body !== undefined ? `body ${JSON.stringify(matcher.body)}` : '',
    ].filter(Boolean);
    return `${method} ${p}${extras.length ? ` with ${extras.join(' and ')}` : ''}`;
}

export function describeCall(call: MatchableCall): string {
    const qs = new URLSearchParams(call.query).toString();
    const body = call.body === null || call.body === undefined ? '' : ` ${typeof call.body === 'string' ? call.body : JSON.stringify(call.body)}`;
    return `${call.method} ${call.path}${qs ? `?${qs}` : ''}${body}`;
}
