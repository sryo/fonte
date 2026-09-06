import dgram from 'dgram';
import { randomInt } from 'crypto';

export interface SwarmCount {
    seeders: number;
    leechers: number;
    completed: number;
}

export interface ScrapeOutcome {
    counts: Map<string, SwarmCount>;
    answered: Set<string>;
}

export const DEFAULT_SCRAPE_TRACKERS = [
    'udp://tracker.opentrackr.org:1337/announce',
    'udp://open.demonii.com:1337/announce',
    'udp://tracker.torrent.eu.org:451/announce',
    'udp://exodus.desync.com:6969/announce',
    'udp://open.stealth.si:80/announce',
    'udp://tracker.therarbg.to:6969/announce',
];

// BEP 15: a connect handshake yields a connection id, then each scrape packet
// carries up to 74 info hashes and comes back as 12 bytes per hash.
const PROTOCOL_ID = Buffer.from('0000041727101980', 'hex');
const ACTION_CONNECT = 0;
const ACTION_SCRAPE = 2;
export const MAX_HASHES_PER_SCRAPE = 74;

export function parseUdpTracker(url: string): { host: string; port: number; key: string } | null {
    const m = url.match(/^udp:\/\/([^/:?#]+):(\d+)/i);
    if (!m) return null;
    const port = parseInt(m[2], 10);
    if (port <= 0 || port > 65535) return null;
    return { host: m[1], port, key: `${m[1].toLowerCase()}:${port}` };
}

export function magnetTrackers(magnetUri: string): string[] {
    const out: string[] = [];
    for (const m of magnetUri.matchAll(/[?&]tr=([^&]+)/g)) {
        try {
            out.push(decodeURIComponent(m[1]));
        } catch {
            // a malformed tracker param is not worth failing the whole magnet
        }
    }
    return out;
}

export function parseScrapeResponse(res: Buffer, hashes: string[], into: Map<string, SwarmCount>): void {
    for (let i = 0; i < hashes.length; i++) {
        const off = 8 + 12 * i;
        if (off + 12 > res.length) break;
        into.set(hashes[i], {
            seeders: res.readInt32BE(off),
            completed: res.readInt32BE(off + 4),
            leechers: res.readInt32BE(off + 8),
        });
    }
}

export async function scrapeTracker(url: string, hashes: string[], timeoutMs = 2500): Promise<Map<string, SwarmCount> | null> {
    const target = parseUdpTracker(url);
    if (!target || hashes.length === 0) return null;

    const socket = dgram.createSocket('udp4');
    const pending = new Map<number, { resolve: (b: Buffer) => void; reject: (e: Error) => void }>();
    socket.on('message', (msg) => {
        if (msg.length < 8) return;
        const waiter = pending.get(msg.readUInt32BE(4));
        if (waiter) waiter.resolve(msg);
    });
    socket.on('error', (err) => {
        for (const waiter of pending.values()) waiter.reject(err);
    });

    const exchange = (packet: Buffer, txn: number): Promise<Buffer> => new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            pending.delete(txn);
            reject(new Error(`${target.key}: no reply in ${timeoutMs}ms`));
        }, timeoutMs);
        pending.set(txn, {
            resolve: (b) => { clearTimeout(timer); pending.delete(txn); resolve(b); },
            reject: (e) => { clearTimeout(timer); pending.delete(txn); reject(e); },
        });
        socket.send(packet, target.port, target.host, (err) => {
            if (err) pending.get(txn)?.reject(err);
        });
    });

    try {
        const connectTxn = randomInt(0, 0xffffffff);
        const connectReq = Buffer.alloc(16);
        PROTOCOL_ID.copy(connectReq, 0);
        connectReq.writeUInt32BE(ACTION_CONNECT, 8);
        connectReq.writeUInt32BE(connectTxn, 12);
        const connectRes = await exchange(connectReq, connectTxn);
        if (connectRes.length < 16 || connectRes.readUInt32BE(0) !== ACTION_CONNECT) return null;
        const connectionId = connectRes.subarray(8, 16);

        const counts = new Map<string, SwarmCount>();
        for (let i = 0; i < hashes.length; i += MAX_HASHES_PER_SCRAPE) {
            const batch = hashes.slice(i, i + MAX_HASHES_PER_SCRAPE);
            const txn = randomInt(0, 0xffffffff);
            const req = Buffer.alloc(16 + 20 * batch.length);
            connectionId.copy(req, 0);
            req.writeUInt32BE(ACTION_SCRAPE, 8);
            req.writeUInt32BE(txn, 12);
            batch.forEach((hash, j) => Buffer.from(hash, 'hex').copy(req, 16 + 20 * j));
            const res = await exchange(req, txn);
            if (res.readUInt32BE(0) !== ACTION_SCRAPE) return counts.size > 0 ? counts : null;
            parseScrapeResponse(res, batch, counts);
        }
        return counts;
    } catch {
        return null;
    } finally {
        socket.close();
    }
}

/** Scrape every tracker in parallel and keep the highest count any of them gave per hash. */
export async function scrapeSwarms(hashes: string[], trackers: string[], timeoutMs = 2500): Promise<ScrapeOutcome> {
    const counts = new Map<string, SwarmCount>();
    const answered = new Set<string>();
    const targets = new Map<string, string>();
    for (const url of trackers) {
        const parsed = parseUdpTracker(url);
        if (parsed && !targets.has(parsed.key)) targets.set(parsed.key, url);
    }
    await Promise.all([...targets].map(async ([key, url]) => {
        const got = await scrapeTracker(url, hashes, timeoutMs);
        if (!got) return;
        answered.add(key);
        for (const [hash, c] of got) {
            const prior = counts.get(hash);
            counts.set(hash, prior
                ? { seeders: Math.max(prior.seeders, c.seeders), leechers: Math.max(prior.leechers, c.leechers), completed: Math.max(prior.completed, c.completed) }
                : c);
        }
    }));
    return { counts, answered };
}
