import fs from 'fs';
import path from 'path';

type TmdbFixtureTable = Record<string, Record<string, unknown>>;

export interface TmdbRequest {
    url: string;
    path: string;
    query: URLSearchParams;
}

export interface TmdbFakeOptions {
    /** When set, any other `api_key` gets TMDB's 401 body. */
    apiKey?: string;
    /** Merged over the canned fixtures, keyed like them: `search/movie` → lowercased query, `find` → external id. */
    fixtures?: TmdbFixtureTable;
    /** Requests to any other host go here; without it they throw. */
    passthrough?: typeof fetch;
}

export interface TmdbFake {
    fetch: typeof fetch;
    requests: TmdbRequest[];
}

export const TMDB_FIXTURES: TmdbFixtureTable = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'tmdb.json'), 'utf8'),
);

const EMPTY_SEARCH = { page: 1, results: [], total_pages: 0, total_results: 0 };
const EMPTY_FIND = { movie_results: [], person_results: [], tv_results: [], tv_episode_results: [], tv_season_results: [] };

function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json;charset=utf-8' } });
}

/**
 * A `fetch` stand-in for api.themoviedb.org, since tmdb-client builds absolute
 * URLs. Install it with `vi.stubGlobal('fetch', tmdb.fetch)`.
 */
export function createTmdbFetch(opts: TmdbFakeOptions = {}): TmdbFake {
    const table: TmdbFixtureTable = {};
    for (const source of [TMDB_FIXTURES, opts.fixtures ?? {}]) {
        for (const [route, entries] of Object.entries(source)) table[route] = { ...table[route], ...entries };
    }
    const requests: TmdbRequest[] = [];

    const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
        if (url.hostname !== 'api.themoviedb.org') {
            if (opts.passthrough) return opts.passthrough(input, init);
            throw new Error(`tmdb fake: unexpected fetch ${url.href}`);
        }
        requests.push({ url: url.href, path: url.pathname, query: url.searchParams });

        if (opts.apiKey && url.searchParams.get('api_key') !== opts.apiKey) {
            return json(401, { status_code: 7, status_message: 'Invalid API key: You must be granted a valid key.', success: false });
        }

        const search = /^\/3\/search\/(movie|tv|multi)$/.exec(url.pathname);
        if (search) {
            const query = (url.searchParams.get('query') ?? '').trim().toLowerCase();
            return json(200, table[`search/${search[1]}`]?.[query] ?? EMPTY_SEARCH);
        }
        const find = /^\/3\/find\/([^/]+)$/.exec(url.pathname);
        if (find) {
            return json(200, table.find?.[decodeURIComponent(find[1])] ?? EMPTY_FIND);
        }
        return json(404, { status_code: 34, status_message: 'The resource you requested could not be found.', success: false });
    }) as typeof fetch;

    return { fetch: fakeFetch, requests };
}
