import type { ServerResponse } from 'http';
import { startHttpFake, send, sendJson, type RecordedRequest } from './http-fake';

export interface TorznabItem {
    title: string;
    infoHash?: string;
    magnetUri?: string;
    link?: string;
    size?: number;
    seeders?: number;
    peers?: number;
    publishDate?: string;
    category?: number[];
}

export interface TorznabQuery {
    indexer: string;
    /** The torznab function; the Jackett JSON endpoint reports `search`. */
    t: string;
    q: string;
    categories: number[];
    params: URLSearchParams;
}

export type TorznabFailure =
    | { status: number; body?: string }
    | { torznabError: { code: number; description: string } };

export interface TorznabIndexerFixture {
    id: string;
    name?: string;
    results?: TorznabItem[] | ((query: TorznabQuery) => TorznabItem[]);
    fail?: TorznabFailure;
}

export interface TorznabFakeOptions {
    indexers: TorznabIndexerFixture[];
    /** When set, any other key is refused with a 401. */
    apiKey?: string;
    failIndexerList?: TorznabFailure;
}

export interface TorznabFake {
    url: string;
    port: number;
    requests: RecordedRequest[];
    indexers: TorznabIndexerFixture[];
    close(): Promise<void>;
}

const DEFAULT_PUBLISH_DATE = '2024-01-01T00:00:00Z';

function escapeXml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function magnetFor(item: TorznabItem): string | undefined {
    if (item.magnetUri) return item.magnetUri;
    if (item.infoHash) return `magnet:?xt=urn:btih:${item.infoHash}&dn=${encodeURIComponent(item.title)}`;
    return undefined;
}

function errorXml(code: number, description: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<error code="${code}" description="${escapeXml(description)}" />`;
}

function capsXml(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<caps>
  <server title="Jackett" />
  <limits default="100" max="100" />
  <searching>
    <search available="yes" supportedParams="q" />
    <tv-search available="yes" supportedParams="q,season,ep,imdbid" />
    <movie-search available="yes" supportedParams="q,imdbid" />
    <music-search available="yes" supportedParams="q" />
    <audio-search available="no" supportedParams="q" />
    <book-search available="no" supportedParams="q" />
  </searching>
  <categories>
    <category id="2000" name="Movies" />
    <category id="3000" name="Audio" />
    <category id="5000" name="TV" />
    <category id="8000" name="Other" />
  </categories>
</caps>`;
}

function indexersXml(indexers: TorznabIndexerFixture[]): string {
    const entries = indexers.map(i => `  <indexer id="${escapeXml(i.id)}" configured="true">
    <title>${escapeXml(i.name ?? i.id)}</title>
    <description>${escapeXml(i.name ?? i.id)} fixture</description>
    <link>https://${escapeXml(i.id)}.invalid/</link>
    <language>en-US</language>
    <type>public</type>
  </indexer>`);
    return `<?xml version="1.0" encoding="UTF-8"?>\n<indexers>\n${entries.join('\n')}\n</indexers>`;
}

function rssXml(indexer: TorznabIndexerFixture, items: TorznabItem[]): string {
    const name = escapeXml(indexer.name ?? indexer.id);
    const body = items.map(item => {
        const magnet = magnetFor(item);
        const link = item.link ?? magnet ?? '';
        const attrs: [string, string | number | undefined][] = [
            ['seeders', item.seeders],
            ['peers', item.peers],
            ['infohash', item.infoHash],
            ['magneturl', magnet],
            ...(item.category ?? [5000]).map(c => ['category', c] as [string, number]),
        ];
        return `    <item>
      <title>${escapeXml(item.title)}</title>
      <guid>${escapeXml(link)}</guid>
      <jackettindexer id="${escapeXml(indexer.id)}">${name}</jackettindexer>
      <link>${escapeXml(link)}</link>
      <pubDate>${new Date(item.publishDate ?? DEFAULT_PUBLISH_DATE).toUTCString()}</pubDate>
      <size>${item.size ?? 0}</size>
      <enclosure url="${escapeXml(link)}" length="${item.size ?? 0}" type="application/x-bittorrent" />
${attrs.filter(([, v]) => v !== undefined).map(([k, v]) => `      <torznab:attr name="${k}" value="${escapeXml(String(v))}" />`).join('\n')}
    </item>`;
    });
    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:torznab="http://torznab.com/schemas/2015/feed">
  <channel>
    <title>${name}</title>
${body.join('\n')}
  </channel>
</rss>`;
}

function jackettResult(indexer: TorznabIndexerFixture, item: TorznabItem) {
    const magnet = magnetFor(item);
    return {
        Tracker: indexer.name ?? indexer.id,
        TrackerId: indexer.id,
        Title: item.title,
        Guid: item.link ?? magnet ?? null,
        Link: item.link ?? null,
        MagnetUri: magnet ?? null,
        InfoHash: item.infoHash ?? null,
        PublishDate: item.publishDate ?? DEFAULT_PUBLISH_DATE,
        Category: item.category ?? [5000],
        Size: item.size ?? 0,
        Seeders: item.seeders ?? null,
        Peers: item.peers ?? null,
    };
}

function resultsFor(indexer: TorznabIndexerFixture, query: TorznabQuery): TorznabItem[] {
    if (typeof indexer.results === 'function') return indexer.results(query);
    return indexer.results ?? [];
}

function sendTorznabFailure(res: ServerResponse, fail: TorznabFailure): void {
    if ('status' in fail) send(res, fail.status, fail.body ?? 'fixture failure');
    else send(res, 200, errorXml(fail.torznabError.code, fail.torznabError.description), { 'Content-Type': 'application/xml' });
}

/**
 * Jackett as Fonte sees it: the torznab API (`t=caps|indexers|search|tvsearch|movie|music`)
 * and the JSON results endpoint that jackett-client searches through, per indexer or `all`.
 */
export async function startTorznabFake(opts: TorznabFakeOptions): Promise<TorznabFake> {
    const indexers = opts.indexers;

    const server = await startHttpFake((req, res) => {
        const match = /^\/api\/v2\.0\/indexers\/([^/]+)\/results(\/torznab(?:\/api)?)?\/?$/.exec(req.path);
        if (!match) {
            send(res, 404, 'not found');
            return;
        }
        const id = decodeURIComponent(match[1]);
        const isTorznab = Boolean(match[2]);
        const keyOk = !opts.apiKey || req.query.get('apikey') === opts.apiKey;
        const targets = id === 'all' ? indexers : indexers.filter(i => i.id === id);

        if (isTorznab) {
            const t = req.query.get('t') ?? '';
            if (!keyOk) {
                send(res, 401, errorXml(100, 'Invalid API Key'), { 'Content-Type': 'application/xml' });
                return;
            }
            if (targets.length === 0 && id !== 'all') {
                send(res, 404, errorXml(201, 'Indexer is not supported'), { 'Content-Type': 'application/xml' });
                return;
            }
            if (t === 'caps') {
                send(res, 200, capsXml(), { 'Content-Type': 'application/xml' });
                return;
            }
            if (t === 'indexers') {
                if (opts.failIndexerList) sendTorznabFailure(res, opts.failIndexerList);
                else send(res, 200, indexersXml(indexers), { 'Content-Type': 'application/xml' });
                return;
            }
            if (!['search', 'tvsearch', 'movie', 'music'].includes(t)) {
                send(res, 200, errorXml(202, `No such function (${t})`), { 'Content-Type': 'application/xml' });
                return;
            }
            const failing = targets.find(i => i.fail);
            if (failing?.fail) {
                sendTorznabFailure(res, failing.fail);
                return;
            }
            const categories = (req.query.get('cat') ?? '').split(',').filter(Boolean).map(Number);
            const items = targets.flatMap(i => resultsFor(i, { indexer: i.id, t, q: req.query.get('q') ?? '', categories, params: req.query }));
            const channel = id === 'all' ? { id: 'all', name: 'AggregateSearch' } : targets[0];
            send(res, 200, rssXml(channel, items), { 'Content-Type': 'application/rss+xml' });
            return;
        }

        if (!keyOk) {
            sendJson(res, 401, { error: 'Invalid API Key' });
            return;
        }
        if (targets.length === 0 && id !== 'all') {
            sendJson(res, 404, { error: `Indexer ${id} not found` });
            return;
        }
        const httpFailure = id !== 'all' ? targets[0].fail : undefined;
        if (httpFailure && 'status' in httpFailure) {
            send(res, httpFailure.status, httpFailure.body ?? 'fixture failure');
            return;
        }
        const categories = req.query.getAll('Category[]').map(Number);
        const q = req.query.get('Query') ?? '';
        const Results: ReturnType<typeof jackettResult>[] = [];
        const Indexers = targets.map(i => {
            const name = i.name ?? i.id;
            if (i.fail) {
                const detail = 'torznabError' in i.fail ? i.fail.torznabError.description : `HTTP ${i.fail.status}`;
                return { ID: i.id, Name: name, Status: 1, Results: 0, Error: `Jackett.Common.IndexerException: Exception (${i.id}): ${detail}` };
            }
            const found = resultsFor(i, { indexer: i.id, t: 'search', q, categories, params: req.query });
            Results.push(...found.map(item => jackettResult(i, item)));
            return { ID: i.id, Name: name, Status: 2, Results: found.length, Error: null };
        });
        sendJson(res, 200, { Results, Indexers });
    });

    return { url: server.url, port: server.port, requests: server.requests, indexers, close: server.close };
}
