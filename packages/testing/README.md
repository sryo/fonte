# Test fakes

Test-only helpers. Not a workspace package and never a runtime dependency: tests import the modules by relative path (`../../testing/src/...`) and vitest compiles them directly. The HTTP fakes listen on `127.0.0.1` on an OS-picked port and record every request.

## Transmission RPC (`src/transmission-fake.ts`)

The 409 `X-Transmission-Session-Id` handshake plus an in-memory torrent table for the methods `TorrentManager` calls: `torrent-add/get/set/start/start-now/stop/remove/verify/reannounce`, `queue-move-*`, `session-get/set`, `port-test`. `torrent-get` honours `ids` (numbers or hashes) and `fields`. `requests` records each RPC with its method, arguments, presented session id and HTTP status.

```ts
const fake = await startTransmissionFake();
const rpc = new TransmissionRpc(fake.host, fake.port);
await rpc.call('torrent-add', { filename: `magnet:?xt=urn:btih:${hash}&dn=Name` });
fake.rotateSessionId();                       // next call gets a 409 and must re-handshake
fake.failNext('torrent-start', 'some error'); // next torrent-start returns result: 'some error'
fake.failNextHttp(500);                       // next authorised request gets a bare 500
fake.addTorrent({ hashString: hash, percentDone: 1, status: TR_STATUS.seeding });
await fake.close();
```

## Jackett and Torznab (`src/torznab-fake.ts`)

Serves the torznab API at `/api/v2.0/indexers/<id|all>/results/torznab/api` (`t=caps`, `t=indexers`, `t=search|tvsearch|movie|music`) and the Jackett JSON endpoint `/api/v2.0/indexers/<id|all>/results` that `jackett-client` actually searches through. Results are an array or a function of the query, so they can vary per query. An indexer can fail with an HTTP status or a torznab `<error>`; on the JSON endpoint the latter shows up as Jackett's `Indexers[].Error`.

```ts
const fake = await startTorznabFake({
    apiKey: 'key',
    indexers: [
        { id: 'alpha', name: 'Alpha', results: q => q.q === 'some show' ? [{ title: 'Some Show S01', infoHash: hash, seeders: 5 }] : [] },
        { id: 'beta', fail: { torznabError: { code: 900, description: 'Challenge detected' } } },
        { id: 'gamma', fail: { status: 500, body: 'upstream exploded' } },
    ],
});
await searchJackett({ query: 'some show', jackettUrl: fake.url, apiKey: 'key' });
```

## TMDB (`src/tmdb-fake.ts`, `fixtures/tmdb.json`)

`tmdb-client` builds absolute `api.themoviedb.org` URLs, so this is a `fetch` stand-in rather than a server. It answers `search/movie|tv|multi` (keyed by lowercased query) and `find/<external id>` from `fixtures/tmdb.json`, unknown queries get empty results, and a wrong `api_key` gets TMDB's 401. Pass `fixtures` to add or override entries.

```ts
const tmdb = createTmdbFetch({ apiKey: 'k', fixtures: { 'search/tv': { 'my show': { results: [/* ... */] } } } });
vi.stubGlobal('fetch', tmdb.fetch);
await searchTmdb({ title: 'Blade Runner', mediaType: 'movie', apiKey: 'k' });
expect(tmdb.requests[0].path).toBe('/3/search/movie');
```

## Provider CLIs (`src/fake-cli.ts`, `fixtures/*.jsonl`)

`writeFakeCli(dir, name, script)` writes an executable Node script `dir/name` that prints `script.lines` (objects are JSON-encoded) with an optional `delayMs` between them, writes `stderr`, then exits with `exitCode`, raises `signal`, or `hang`s until killed. Every run appends its argv and cwd, read back with `invocations()`. `loadRecording('claude-stream' | 'codex-stream')` returns the recorded stream-json lines.

```ts
const cli = writeFakeCli(binDir, 'claude', { lines: loadRecording('claude-stream') });
await getAdapter('anthropic')!.invoke({ ...opts, envOverrides: { PATH: `${binDir}:${process.env.PATH}` } });
expect(cli.invocations()[0].argv).toContain('stream-json');
```
