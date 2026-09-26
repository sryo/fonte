import os from 'os';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { normalizeTorrentConfigPatch } from './torrent-config';

const home = process.env.HOME || os.homedir();

describe('normalizeTorrentConfigPatch', () => {
    it('expands ~ in the download directory', () => {
        expect(normalizeTorrentConfigPatch({ download_dir: '~/Movies/fonte' }))
            .toEqual({ patch: { download_dir: path.join(home, 'Movies/fonte') } });
    });

    it('trims whitespace and a trailing slash from the download directory', () => {
        expect(normalizeTorrentConfigPatch({ download_dir: '  /data/torrents/  ' }))
            .toEqual({ patch: { download_dir: '/data/torrents' } });
    });

    it('rejects an empty download directory', () => {
        expect(normalizeTorrentConfigPatch({ download_dir: '   ' }).error).toMatch(/download directory/i);
        expect(normalizeTorrentConfigPatch({ download_dir: null as unknown as string }).error).toMatch(/download directory/i);
    });

    it('rejects a relative download directory', () => {
        expect(normalizeTorrentConfigPatch({ download_dir: 'Downloads/fonte' }).error).toMatch(/absolute/i);
    });

    it('rejects out-of-range numbers', () => {
        expect(normalizeTorrentConfigPatch({ max_concurrent: 0 }).error).toMatch(/max_concurrent/);
        expect(normalizeTorrentConfigPatch({ max_concurrent: 1.5 }).error).toMatch(/max_concurrent/);
        expect(normalizeTorrentConfigPatch({ max_download_speed: -1 }).error).toMatch(/max_download_speed/);
        expect(normalizeTorrentConfigPatch({ max_upload_speed: -5 }).error).toMatch(/max_upload_speed/);
        expect(normalizeTorrentConfigPatch({ seed_ratio_limit: -0.1 }).error).toMatch(/seed_ratio_limit/);
        expect(normalizeTorrentConfigPatch({ port: 70000 }).error).toMatch(/port/);
    });

    it('rounds speeds to whole KB/s, since Transmission takes integers', () => {
        expect(normalizeTorrentConfigPatch({ max_download_speed: 150.6, max_upload_speed: 0 }))
            .toEqual({ patch: { max_download_speed: 151, max_upload_speed: 0 } });
    });

    it('passes valid values through untouched', () => {
        const patch = { max_concurrent: 3, seed_ratio_limit: 1.5, dht: false, port: 0 };
        expect(normalizeTorrentConfigPatch(patch)).toEqual({ patch });
    });
});
