import dgram from 'dgram';
import { describe, it, expect, afterEach } from 'vitest';
import { magnetTrackers, parseScrapeResponse, parseUdpTracker, scrapeSwarms, scrapeTracker } from './tracker-scrape';

const HASH_A = 'a'.repeat(40);
const HASH_B = 'b'.repeat(40);

// Minimal BEP 15 tracker: answers connect with a fixed connection id and
// scrape with the counts from `swarm`, or stays silent when `mute` is set.
function fakeTracker(swarm: Record<string, [number, number, number]>, mute = false): Promise<{ url: string; close: () => void }> {
    return new Promise((resolve) => {
        const server = dgram.createSocket('udp4');
        server.on('message', (msg, rinfo) => {
            if (mute) return;
            const action = msg.readUInt32BE(8);
            const txn = msg.readUInt32BE(12);
            if (action === 0) {
                const res = Buffer.alloc(16);
                res.writeUInt32BE(0, 0);
                res.writeUInt32BE(txn, 4);
                res.write('deadbeefdeadbeef', 8, 'hex');
                server.send(res, rinfo.port, rinfo.address);
                return;
            }
            const count = (msg.length - 16) / 20;
            const res = Buffer.alloc(8 + 12 * count);
            res.writeUInt32BE(2, 0);
            res.writeUInt32BE(txn, 4);
            for (let i = 0; i < count; i++) {
                const hash = msg.subarray(16 + 20 * i, 36 + 20 * i).toString('hex');
                const [seeders, completed, leechers] = swarm[hash] ?? [0, 0, 0];
                res.writeInt32BE(seeders, 8 + 12 * i);
                res.writeInt32BE(completed, 12 + 12 * i);
                res.writeInt32BE(leechers, 16 + 12 * i);
            }
            server.send(res, rinfo.port, rinfo.address);
        });
        server.bind(0, '127.0.0.1', () => {
            resolve({ url: `udp://127.0.0.1:${server.address().port}/announce`, close: () => server.close() });
        });
    });
}

const opened: (() => void)[] = [];
afterEach(() => {
    for (const close of opened.splice(0)) close();
});

describe('parseUdpTracker', () => {
    it('reads host and port and ignores other schemes', () => {
        expect(parseUdpTracker('udp://Tracker.Example:1337/announce')).toEqual({ host: 'Tracker.Example', port: 1337, key: 'tracker.example:1337' });
        expect(parseUdpTracker('http://tracker.example/announce')).toBeNull();
        expect(parseUdpTracker('udp://tracker.example/announce')).toBeNull();
    });
});

describe('magnetTrackers', () => {
    it('decodes every tr param', () => {
        const magnet = 'magnet:?xt=urn:btih:' + HASH_A + '&tr=udp%3A%2F%2Fa.example%3A1&tr=udp%3A%2F%2Fb.example%3A2%2Fannounce';
        expect(magnetTrackers(magnet)).toEqual(['udp://a.example:1', 'udp://b.example:2/announce']);
    });
});

describe('parseScrapeResponse', () => {
    it('reads seeders, completed, leechers per hash and stops at a short packet', () => {
        const res = Buffer.alloc(8 + 12);
        res.writeUInt32BE(2, 0);
        res.writeInt32BE(7, 8);
        res.writeInt32BE(30, 12);
        res.writeInt32BE(3, 16);
        const into = new Map();
        parseScrapeResponse(res, [HASH_A, HASH_B], into);
        expect(into.get(HASH_A)).toEqual({ seeders: 7, completed: 30, leechers: 3 });
        expect(into.has(HASH_B)).toBe(false);
    });
});

describe('scrapeTracker', () => {
    it('completes the connect and scrape exchange against a tracker', async () => {
        const tracker = await fakeTracker({ [HASH_A]: [12, 100, 4] });
        opened.push(tracker.close);
        const counts = await scrapeTracker(tracker.url, [HASH_A, HASH_B]);
        expect(counts?.get(HASH_A)).toEqual({ seeders: 12, completed: 100, leechers: 4 });
        expect(counts?.get(HASH_B)).toEqual({ seeders: 0, completed: 0, leechers: 0 });
    });

    it('returns null when the tracker never answers', async () => {
        const tracker = await fakeTracker({}, true);
        opened.push(tracker.close);
        expect(await scrapeTracker(tracker.url, [HASH_A], 150)).toBeNull();
    });
});

describe('scrapeSwarms', () => {
    it('keeps the highest count across trackers and records who answered', async () => {
        const low = await fakeTracker({ [HASH_A]: [2, 5, 1] });
        const high = await fakeTracker({ [HASH_A]: [9, 5, 0] });
        const silent = await fakeTracker({}, true);
        opened.push(low.close, high.close, silent.close);

        const { counts, answered } = await scrapeSwarms([HASH_A], [low.url, high.url, silent.url, 'http://ignored.example/announce'], 200);

        expect(counts.get(HASH_A)).toEqual({ seeders: 9, completed: 5, leechers: 1 });
        expect(answered.size).toBe(2);
        expect(answered.has(parseUdpTracker(silent.url)!.key)).toBe(false);
    });
});
