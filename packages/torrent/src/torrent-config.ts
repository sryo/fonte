import path from 'path';
import { expandHomePath } from '@fonte/core';
import type { TorrentConfig } from './types';

type Normalized = { patch: Partial<TorrentConfig>; error?: undefined } | { patch?: undefined; error: string };

function checkRange(key: string, value: number, min: number, max: number, integer: boolean): string | null {
    if (value < min || value > max || (integer && !Number.isInteger(value))) {
        return `"${key}" must be ${integer ? 'a whole number' : 'a number'} from ${min}${max === Infinity ? ' up' : ` to ${max}`}`;
    }
    return null;
}

export function normalizeTorrentConfigPatch(input: Partial<TorrentConfig>): Normalized {
    const patch: Partial<TorrentConfig> = { ...input };

    if ('download_dir' in input) {
        const raw = typeof input.download_dir === 'string' ? input.download_dir.trim() : '';
        if (!raw) return { error: 'Download directory cannot be empty' };
        const expanded = expandHomePath(raw) ?? raw;
        if (!path.isAbsolute(expanded)) {
            return { error: 'Download directory must be an absolute path, like ~/Downloads/fonte' };
        }
        patch.download_dir = path.resolve(expanded);
    }

    const ranges: [keyof TorrentConfig, number, number, boolean][] = [
        ['max_concurrent', 1, Infinity, true],
        ['max_download_speed', 0, Infinity, false],
        ['max_upload_speed', 0, Infinity, false],
        ['seed_ratio_limit', 0, Infinity, false],
        ['port', 0, 65535, true],
    ];
    for (const [key, min, max, integer] of ranges) {
        const value = input[key];
        if (typeof value !== 'number') continue;
        const error = checkRange(key, value, min, max, integer);
        if (error) return { error };
    }
    if (typeof patch.max_download_speed === 'number') patch.max_download_speed = Math.round(patch.max_download_speed);
    if (typeof patch.max_upload_speed === 'number') patch.max_upload_speed = Math.round(patch.max_upload_speed);

    return { patch };
}
