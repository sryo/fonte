import crypto from 'crypto';
import { startHttpFake, send, sendJson } from './http-fake';

export interface FakeTorrent {
    id: number;
    hashString: string;
    name: string;
    status: number;
    percentDone: number;
    downloadDir: string;
    [field: string]: unknown;
}

export interface TransmissionRequest {
    method: string;
    arguments: Record<string, any> | undefined;
    sessionId: string | undefined;
    status: number;
}

export interface TransmissionFakeOptions {
    session?: Record<string, unknown>;
    portIsOpen?: boolean;
}

export interface TransmissionFake {
    url: string;
    host: string;
    port: number;
    readonly sessionId: string;
    requests: TransmissionRequest[];
    torrents: Map<number, FakeTorrent>;
    session: Record<string, unknown>;
    addTorrent(partial: Partial<FakeTorrent> & { hashString: string }): FakeTorrent;
    rotateSessionId(): string;
    failNext(method: string, result: string): void;
    failNextHttp(status: number): void;
    close(): Promise<void>;
}

export const TR_STATUS = { stopped: 0, checkWait: 1, checking: 2, downloadWait: 3, downloading: 4, seedWait: 5, seeding: 6 } as const;

const NO_OP_METHODS = new Set([
    'torrent-verify', 'torrent-reannounce',
    'queue-move-top', 'queue-move-up', 'queue-move-down', 'queue-move-bottom',
]);

function newSessionId(): string {
    return crypto.randomBytes(24).toString('base64url');
}

function torrentDefaults(): Omit<FakeTorrent, 'id' | 'hashString' | 'name'> {
    return {
        status: TR_STATUS.downloading,
        percentDone: 0,
        downloadDir: '/downloads',
        rateDownload: 0,
        rateUpload: 0,
        downloadedEver: 0,
        uploadedEver: 0,
        totalSize: 0,
        peersConnected: 0,
        error: 0,
        errorString: '',
        queuePosition: 0,
        bandwidthPriority: 0,
        trackerStats: [],
        files: [],
        fileStats: [],
        pieces: '',
        pieceCount: 0,
        availability: [],
    };
}

function sourceIdentity(args: Record<string, any>): { hash: string; name?: string } {
    if (typeof args.filename === 'string') {
        if (/^[a-f0-9]{40}$/i.test(args.filename)) return { hash: args.filename.toLowerCase() };
        if (args.filename.startsWith('magnet:')) {
            const params = new URLSearchParams(args.filename.slice(args.filename.indexOf('?') + 1));
            const hash = /urn:btih:([a-f0-9]{40})/i.exec(params.get('xt') ?? '')?.[1];
            if (!hash) throw new Error('invalid or corrupt torrent file');
            return { hash: hash.toLowerCase(), name: params.get('dn') ?? undefined };
        }
    }
    if (typeof args.metainfo === 'string') {
        return { hash: crypto.createHash('sha1').update(args.metainfo).digest('hex') };
    }
    throw new Error('invalid or corrupt torrent file');
}

/**
 * Transmission's RPC endpoint in miniature: the 409 session-id handshake and an
 * in-memory torrent table for the methods TorrentManager calls.
 */
export async function startTransmissionFake(opts: TransmissionFakeOptions = {}): Promise<TransmissionFake> {
    let sessionId = newSessionId();
    let nextId = 1;
    const torrents = new Map<number, FakeTorrent>();
    const session: Record<string, unknown> = {
        'peer-port': 51413,
        'download-dir': '/downloads',
        'speed-limit-down': 100,
        'speed-limit-down-enabled': false,
        'speed-limit-up': 100,
        'speed-limit-up-enabled': false,
        version: '4.0.6 (38c164933e)',
        'rpc-version': 17,
        ...opts.session,
    };
    const requests: TransmissionRequest[] = [];
    const pendingFailures = new Map<string, string>();
    let pendingHttpStatus: number | null = null;

    function addTorrent(partial: Partial<FakeTorrent> & { hashString: string }): FakeTorrent {
        const id = partial.id ?? nextId++;
        nextId = Math.max(nextId, id + 1);
        const torrent = { ...torrentDefaults(), queuePosition: torrents.size, name: partial.hashString, ...partial, id } as FakeTorrent;
        torrents.set(id, torrent);
        return torrent;
    }

    function select(ids: unknown): FakeTorrent[] {
        const all = [...torrents.values()];
        if (ids === undefined || ids === 'recently-active') return all;
        const wanted = Array.isArray(ids) ? ids : [ids];
        return all.filter(t => wanted.some(w => w === t.id || (typeof w === 'string' && w.toLowerCase() === t.hashString)));
    }

    function pick(source: Record<string, unknown>, fields: unknown): Record<string, unknown> {
        if (!Array.isArray(fields)) return { ...source };
        return Object.fromEntries(fields.filter(f => f in source).map(f => [f, source[f]]));
    }

    function handle(method: string, args: Record<string, any>): Record<string, unknown> {
        switch (method) {
            case 'session-get':
                return pick(session, args.fields);
            case 'session-set':
                Object.assign(session, args);
                return {};
            case 'port-test':
                return { 'port-is-open': opts.portIsOpen ?? true };
            case 'torrent-add': {
                const { hash, name } = sourceIdentity(args);
                const existing = [...torrents.values()].find(t => t.hashString === hash);
                if (existing) return { 'torrent-duplicate': { id: existing.id, hashString: existing.hashString, name: existing.name } };
                const added = addTorrent({
                    hashString: hash,
                    name: name ?? hash,
                    status: args.paused ? TR_STATUS.stopped : TR_STATUS.downloading,
                    ...(args['download-dir'] ? { downloadDir: args['download-dir'] } : {}),
                });
                return { 'torrent-added': { id: added.id, hashString: added.hashString, name: added.name } };
            }
            case 'torrent-get':
                return { torrents: select(args.ids).map(t => pick(t, args.fields)) };
            case 'torrent-start':
            case 'torrent-start-now':
                for (const t of select(args.ids)) t.status = t.percentDone >= 1 ? TR_STATUS.seeding : TR_STATUS.downloading;
                return {};
            case 'torrent-stop':
                for (const t of select(args.ids)) t.status = TR_STATUS.stopped;
                return {};
            case 'torrent-remove':
                for (const t of select(args.ids)) torrents.delete(t.id);
                return {};
            case 'torrent-set': {
                const { ids, ...changes } = args;
                for (const t of select(ids)) Object.assign(t, changes);
                return {};
            }
            default:
                if (NO_OP_METHODS.has(method)) return {};
                throw new Error('method name not recognized');
        }
    }

    const server = await startHttpFake((req, res) => {
        let payload: { method?: string; arguments?: Record<string, any>; tag?: number } = {};
        try {
            payload = JSON.parse(req.body || '{}');
        } catch {}
        const method = payload.method ?? '';
        const presented = req.headers['x-transmission-session-id'] as string | undefined;
        const record = (status: number) => requests.push({ method, arguments: payload.arguments, sessionId: presented, status });

        if (req.method !== 'POST' || req.path !== '/transmission/rpc') {
            record(404);
            send(res, 404, 'not found');
            return;
        }
        if (presented !== sessionId) {
            record(409);
            send(res, 409, '<h1>409: Conflict</h1>', { 'X-Transmission-Session-Id': sessionId });
            return;
        }
        if (pendingHttpStatus !== null) {
            const status = pendingHttpStatus;
            pendingHttpStatus = null;
            record(status);
            send(res, status, 'fake failure');
            return;
        }

        record(200);
        const tag = payload.tag !== undefined ? { tag: payload.tag } : {};
        const failure = pendingFailures.get(method);
        if (failure !== undefined) {
            pendingFailures.delete(method);
            sendJson(res, 200, { result: failure, arguments: {}, ...tag });
            return;
        }
        try {
            sendJson(res, 200, { result: 'success', arguments: handle(method, payload.arguments ?? {}), ...tag }, { 'X-Transmission-Session-Id': sessionId });
        } catch (err) {
            sendJson(res, 200, { result: (err as Error).message, arguments: {}, ...tag });
        }
    });

    return {
        url: `${server.url}/transmission/rpc`,
        host: server.host,
        port: server.port,
        get sessionId() {
            return sessionId;
        },
        requests,
        torrents,
        session,
        addTorrent,
        rotateSessionId() {
            sessionId = newSessionId();
            return sessionId;
        },
        failNext(method, result) {
            pendingFailures.set(method, result);
        },
        failNextHttp(status) {
            pendingHttpStatus = status;
        },
        close: server.close,
    };
}
