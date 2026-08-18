import { describe, it, expect } from 'vitest';
import { extractTraits, buildAffinity } from './release-affinity';

const INCIDENT = '[Anime Land] The Furious (2025) (UHD BDRip 1080p AV1 HDR10 EAC3 Atmos) CHINESE [D750ADCB].mkv';

describe('extractTraits', () => {
    it('extracts group, source, codec, audio, hdr, and language traits', () => {
        const traits = extractTraits(INCIDENT);
        expect(traits).toContain('grp:anime land');
        expect(traits).toContain('src:uhd');
        expect(traits).toContain('src:bdrip');
        expect(traits).toContain('codec:av1');
        expect(traits).toContain('hdr:hdr');
        expect(traits).toContain('aud:ddp');
        expect(traits).toContain('aud:atmos');
        expect(traits).toContain('lang:chinese');
    });

    it('never emits resolution traits', () => {
        for (const trait of extractTraits('Show 2160p 1080p 720p 4k WEB-DL')) {
            expect(trait).not.toMatch(/1080|2160|720|4k/);
        }
    });

    it('extracts a trailing group past indexer brackets and file extension', () => {
        const traits = extractTraits('Futurama.S14E04.1080p.WEB.h264-ETHEL[EZTVx.to].mkv');
        expect(traits).toContain('grp:ethel');
        expect(traits).toContain('src:web');
        expect(traits).toContain('codec:h264');
    });

    it('normalizes codec spellings to one token', () => {
        for (const title of ['Show x265', 'Show HEVC', 'Show h.265', 'Show H265']) {
            expect(extractTraits(title)).toContain('codec:h265');
        }
    });

    it('does not misread web-dl as plain web', () => {
        const traits = extractTraits('Show 1080p WEB-DL');
        expect(traits).toContain('src:webdl');
        expect(traits).not.toContain('src:web');
    });
});

describe('buildAffinity', () => {
    it('scores 0 with no votes', () => {
        expect(buildAffinity([], [])(INCIDENT)).toBe(0);
    });

    it('scores the exact downvoted release at -1', () => {
        expect(buildAffinity([], [INCIDENT])(INCIDENT)).toBe(-1);
    });

    it('penalizes siblings of the downvoted release, leaves clean releases at 0', () => {
        const affinity = buildAffinity([], [INCIDENT]);
        expect(affinity('[Anime Land] Another Movie (2026) BDRip AV1 CHINESE.mkv')).toBeLessThan(0);
        expect(affinity('Another.Movie.2026.1080p.WEB-DL.x265-NiceGroup')).toBe(0);
    });

    it('boosts releases sharing upvoted traits', () => {
        const affinity = buildAffinity(['Show S01E01 1080p WEB h264-ETHEL'], []);
        expect(affinity('Show.S01E02.1080p.WEB.h264-ETHEL.mkv')).toBeGreaterThan(0);
    });

    it('cancels contradictory votes on the same trait', () => {
        const affinity = buildAffinity(['A x265-G1'], ['B x265-G2']);
        expect(affinity('C x265')).toBe(0);
    });

    it('stays within [-1, 1]', () => {
        const affinity = buildAffinity([INCIDENT, INCIDENT], ['Show 1080p WEB-DL x265-Good']);
        for (const title of [INCIDENT, 'Show 1080p WEB-DL x265-Good', 'Unrelated Thing']) {
            const score = affinity(title);
            expect(score).toBeGreaterThanOrEqual(-1);
            expect(score).toBeLessThanOrEqual(1);
        }
    });
});
