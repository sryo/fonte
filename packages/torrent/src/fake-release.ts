import path from 'path';
import type { MediaType } from './types';

const EXECUTABLE_EXTENSIONS = new Set([
    '.exe', '.msi', '.scr', '.bat', '.cmd', '.pif', '.lnk', '.vbs', '.vbe', '.jse', '.wsf', '.hta',
    '.ps1', '.jar', '.apk', '.dmg', '.pkg',
]);

const MEDIA_KINDS = new Set<MediaType>(['movie', 'tv', 'music']);

/** The first file that would run rather than play, for a watch that expects media. */
export function executableIn(mediaType: MediaType, filePaths: string[]): string | undefined {
    if (!MEDIA_KINDS.has(mediaType)) return undefined;
    return filePaths.find(p => EXECUTABLE_EXTENSIONS.has(path.extname(p).toLowerCase())
        || p.split('/').some(part => part.toLowerCase().endsWith('.app')));
}
