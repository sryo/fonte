import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TransmissionRpc } from './transmission-rpc';
import { startTransmissionFake, type TransmissionFake } from '../../testing/src/transmission-fake';

const HASH = 'ab'.repeat(20);
const MAGNET = `magnet:?xt=urn:btih:${HASH}&dn=Some.Show.S01`;

let fake: TransmissionFake;
let rpc: TransmissionRpc;

beforeEach(async () => {
    fake = await startTransmissionFake();
    rpc = new TransmissionRpc(fake.host, fake.port);
});

afterEach(async () => {
    await fake.close();
});

describe('TransmissionRpc', () => {
    it('picks up the session id from the 409 handshake before its first call', async () => {
        const added = await rpc.call('torrent-add', { filename: MAGNET, 'download-dir': '/dl' });

        expect(added['torrent-added']).toEqual({ id: 1, hashString: HASH, name: 'Some.Show.S01' });
        expect(fake.requests.map(r => r.status)).toEqual([409, 200]);
        expect(fake.requests[0].sessionId).toBeUndefined();
        expect(fake.requests[1]).toMatchObject({ method: 'torrent-add', sessionId: fake.sessionId });
    });

    it('reuses the session id while it stays valid', async () => {
        await rpc.call('session-get');
        await rpc.call('session-get');

        expect(fake.requests.map(r => r.status)).toEqual([409, 200, 200]);
    });

    it('reacquires an expired session id and retries the call once', async () => {
        await rpc.call('torrent-add', { filename: MAGNET });
        const fresh = fake.rotateSessionId();

        const res = await rpc.call('torrent-get', { ids: [HASH], fields: ['id', 'name'] });

        expect(res.torrents).toEqual([{ id: 1, name: 'Some.Show.S01' }]);
        const last = fake.requests.at(-1)!;
        expect(last).toMatchObject({ method: 'torrent-get', status: 200, sessionId: fresh });
        expect(fake.requests.filter(r => r.method === 'torrent-get').map(r => r.status)).toEqual([409, 200]);
    });

    it('surfaces a non-success result as an error', async () => {
        fake.failNext('torrent-start', 'invalid or corrupt torrent file');

        await expect(rpc.call('torrent-start', { ids: [1] })).rejects.toThrow('Transmission RPC: invalid or corrupt torrent file');
        await expect(rpc.call('torrent-start', { ids: [1] })).resolves.toEqual({});
    });

    it('rejects a method Transmission does not know', async () => {
        await expect(rpc.call('torrent-frobnicate')).rejects.toThrow('Transmission RPC: method name not recognized');
    });

    it('surfaces an HTTP failure with its status', async () => {
        fake.failNextHttp(500);

        await expect(rpc.call('session-get')).rejects.toThrow('Transmission RPC error (500)');
    });

    it('drives the torrent table through stop, start, set and remove', async () => {
        await rpc.call('torrent-add', { filename: MAGNET, paused: true });
        expect((await rpc.call('torrent-get', { ids: [1], fields: ['status'] })).torrents).toEqual([{ status: 0 }]);

        await rpc.call('torrent-start', { ids: [1] });
        await rpc.call('torrent-set', { ids: [HASH], bandwidthPriority: 1 });
        expect((await rpc.call('torrent-get', { fields: ['status', 'bandwidthPriority'] })).torrents).toEqual([{ status: 4, bandwidthPriority: 1 }]);

        await rpc.call('torrent-stop', { ids: [1] });
        expect(fake.torrents.get(1)!.status).toBe(0);

        await rpc.call('torrent-remove', { ids: [1], 'delete-local-data': false });
        expect((await rpc.call('torrent-get', { fields: ['id'] })).torrents).toEqual([]);
    });

    it('reports a re-added hash as a duplicate', async () => {
        await rpc.call('torrent-add', { filename: MAGNET });

        const again = await rpc.call('torrent-add', { filename: HASH });

        expect(again).toEqual({ 'torrent-duplicate': { id: 1, hashString: HASH, name: 'Some.Show.S01' } });
    });

    it('reads and writes session settings', async () => {
        await rpc.call('session-set', { 'speed-limit-down': 500, 'speed-limit-down-enabled': true });

        const session = await rpc.call('session-get', { fields: ['peer-port', 'speed-limit-down'] });

        expect(session).toEqual({ 'peer-port': 51413, 'speed-limit-down': 500 });
        expect(await rpc.call('port-test')).toEqual({ 'port-is-open': true });
    });

    it('reports unavailable once the server is gone', async () => {
        expect(await rpc.isAvailable()).toBe(true);
        await fake.close();

        expect(await new TransmissionRpc(fake.host, fake.port).isAvailable()).toBe(false);
    });
});
