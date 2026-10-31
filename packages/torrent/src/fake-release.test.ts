import { describe, it, expect } from 'vitest';
import { executableIn } from './fake-release';

describe('executableIn', () => {
    it('flags a movie whose payload is an executable', () => {
        expect(executableIn('movie', ['You Can See Everything 2026.1080p. HD h264- ETHE.exe']))
            .toBe('You Can See Everything 2026.1080p. HD h264- ETHE.exe');
    });

    it('flags a shortcut or installer hidden next to the video', () => {
        expect(executableIn('tv', ['Show S01E01/Show S01E01.mkv', 'Show S01E01/Codec Pack.LNK'])).toBe('Show S01E01/Codec Pack.LNK');
        expect(executableIn('movie', ['Film/Player.app/Contents/MacOS/Player'])).toBe('Film/Player.app/Contents/MacOS/Player');
    });

    it('passes ordinary media releases', () => {
        expect(executableIn('movie', ['Film 2026/Film.2026.1080p.mkv', 'Film 2026/Film.srt', 'Film 2026/www.site.com.txt'])).toBeUndefined();
        expect(executableIn('music', ['Album/01 Track.flac', 'Album/cover.jpg'])).toBeUndefined();
    });

    it('leaves software and other kinds alone', () => {
        expect(executableIn('app', ['Tool/setup.exe'])).toBeUndefined();
        expect(executableIn('other', ['thing.exe'])).toBeUndefined();
    });
});
