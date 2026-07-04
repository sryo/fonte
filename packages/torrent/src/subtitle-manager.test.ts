import { describe, it, expect } from 'vitest';
import { parseTorrentName } from './subtitle-manager';

describe('parseTorrentName', () => {
    it('parses a movie name with a parenthesised year', () => {
        expect(parseTorrentName('Misericordia (2024) 1080p BluRay 5.1-WORLD'))
            .toEqual({ title: 'Misericordia', year: 2024, isTv: false });
    });

    it('parses a dot-separated TV episode name', () => {
        expect(parseTorrentName('Star.City.S01E02.1080p.x265-ELiTE'))
            .toEqual({ title: 'Star City', year: undefined, isTv: true });
    });

    it('parses a dot-separated movie with foreign characters', () => {
        expect(parseTorrentName('Love.-.Kjærlighet.2024.Norwegian.BluRay.1080p.x265'))
            .toEqual({ title: 'Love - Kjærlighet', year: 2024, isTv: false });
    });

    it('keeps a leading bracket tag in the title', () => {
        // characterizes current behavior: bracketed release-group prefixes are not stripped
        expect(parseTorrentName('[TGx] Misericordia (2024) 1080p WEBRip x264'))
            .toEqual({ title: '[TGx] Misericordia', year: 2024, isTv: false });
    });

    it('does not recognize a bracketed year', () => {
        // characterizes current behavior: the year regex only accepts whitespace, dots,
        // and parentheses as delimiters, so [2024] stays inside the title
        expect(parseTorrentName('Movie Name [2024] [1080p]'))
            .toEqual({ title: 'Movie Name [2024]', year: undefined, isTv: false });
    });

    it('returns a plain name without a year untouched', () => {
        expect(parseTorrentName('Big Buck Bunny'))
            .toEqual({ title: 'Big Buck Bunny', year: undefined, isTv: false });
    });

    it('treats + as a separator in URL-encoded-style names', () => {
        expect(parseTorrentName('Honey+Bunch+2025+1080p+WEB-DL+HEVC+x265'))
            .toEqual({ title: 'Honey Bunch', year: 2025, isTv: false });
        expect(parseTorrentName('The+Love+That+Remains+(2025)+1080p+WEBRip'))
            .toEqual({ title: 'The Love That Remains', year: 2025, isTv: false });
    });
});
