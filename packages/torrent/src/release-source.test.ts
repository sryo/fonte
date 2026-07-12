import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveReleaseSource } from './release-source';

const HEX = '0123456789abcdef0123456789abcdef01234567';
const MAGNET = `magnet:?xt=urn:btih:${HEX}&dn=Show`;

// A minimal Response-ish stub for the manual-redirect fetch path.
function fakeRes(init: { status?: number; ok?: boolean; location?: string; body?: Buffer }): Response {
    const status = init.status ?? 200;
    return {
        status,
        ok: init.ok ?? (status >= 200 && status < 300),
        headers: { get: (k: string) => (k.toLowerCase() === 'location' ? init.location ?? null : null) },
        body: { cancel: async () => {} },
        arrayBuffer: async () => {
            const b = init.body ?? Buffer.alloc(0);
            return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
        },
    } as unknown as Response;
}

const torrentBytes = () => Buffer.from('d8:announce9:track.url4:infod6:lengthi1eee');

afterEach(() => vi.unstubAllGlobals());

describe('resolveReleaseSource', () => {
    it('passes magnets and bare hashes through without any fetch', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        expect(await resolveReleaseSource(MAGNET)).toBe(MAGNET);
        expect(await resolveReleaseSource(HEX)).toBe(HEX);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('leaves a non-HTTP source (local path) untouched', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        expect(await resolveReleaseSource('/downloads/x.torrent')).toBe('/downloads/x.torrent');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('follows an HTTP redirect to a magnet', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => fakeRes({ status: 302, location: MAGNET })));
        expect(await resolveReleaseSource('https://jackett.test/dl/token')).toBe(MAGNET);
    });

    it('downloads .torrent bytes and returns a Buffer', async () => {
        const bytes = torrentBytes();
        vi.stubGlobal('fetch', vi.fn(async () => fakeRes({ status: 200, body: bytes })));
        const out = await resolveReleaseSource('https://jackett.test/dl/token.torrent');
        expect(Buffer.isBuffer(out)).toBe(true);
        expect((out as Buffer).equals(bytes)).toBe(true);
    });

    it('throws a clean error when the indexer 500s', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => fakeRes({ status: 500, ok: false })));
        await expect(resolveReleaseSource('https://jackett.test/dl/dead'))
            .rejects.toThrow(/Indexer returned 500/);
    });

    it('rejects an HTML error page masquerading as a download', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => fakeRes({ status: 200, body: Buffer.from('<html>nope</html>') })));
        await expect(resolveReleaseSource('https://jackett.test/dl/html'))
            .rejects.toThrow(/did not return a \.torrent/);
    });
});
