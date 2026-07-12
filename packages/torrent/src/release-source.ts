// ── Release source resolution ─────────────────────────────────────────────────
// Search / alternative results sometimes carry an HTTP .torrent link instead of
// a magnet — Jackett falls back to r.Link and BT4G uses the RSS <link>. Handing
// such a URL straight to Transmission makes *it* fetch the indexer, so a flaky
// indexer surfaces as the opaque "Couldn't fetch torrent: Internal Server Error
// (500)". Resolving here — following redirects to a magnet, or downloading the
// .torrent bytes ourselves — keeps that fetch on our side, where a failure is a
// legible error the caller can recover from (e.g. try the next alternative).

const MAGNET_RE = /^magnet:/i;
const HEX40_RE = /^[a-fA-F0-9]{40}$/;
const HTTP_RE = /^https?:\/\//i;
const REQUEST_TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 3;

/** A magnet/hash string Transmission can add directly, or raw .torrent bytes. */
export type ReleaseSource = string | Buffer;

export async function resolveReleaseSource(uri: string): Promise<ReleaseSource> {
    // Magnets, bare info hashes, and anything non-HTTP (local paths) need no
    // network round-trip — hand them back for the caller's existing handling.
    if (MAGNET_RE.test(uri) || HEX40_RE.test(uri) || !HTTP_RE.test(uri)) return uri;

    let url = uri;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const res = await fetch(url, {
            redirect: 'manual',
            headers: { Accept: 'application/x-bittorrent,*/*' },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (res.status >= 300 && res.status < 400) {
            const location = res.headers.get('location');
            void res.body?.cancel();
            if (!location) throw new Error(`Indexer redirect without a location (${res.status})`);
            if (MAGNET_RE.test(location)) return location;
            url = new URL(location, url).toString();
            continue;
        }

        if (!res.ok) throw new Error(`Indexer returned ${res.status} for this release`);

        const buf = Buffer.from(await res.arrayBuffer());
        if (!looksLikeTorrent(buf)) throw new Error('Release link did not return a .torrent file');
        return buf;
    }

    throw new Error('Too many redirects fetching the release');
}

// A bencoded .torrent is a dictionary: byte 'd' followed by keys like
// '8:announce' / '4:info'. Guards against indexer HTML error pages (which start
// with '<') slipping through as metainfo.
function looksLikeTorrent(buf: Buffer): boolean {
    if (buf.length < 16 || buf[0] !== 0x64 /* 'd' */) return false;
    const head = buf.subarray(0, 64).toString('latin1');
    return head.includes('announce') || head.includes('info');
}
