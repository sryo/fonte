// Runs via root `npm test` (vitest's default glob sweeps the dashboard even
// though it isn't a workspace). Imports must stay relative — nothing maps the
// "@/" alias outside Next.
import { describe, it, expect } from "vitest";
import {
  groupReleases,
  parseEpisodeKey,
  partitionRejectedLast,
  resolutionMatches,
  resolutionTag,
  seederTone,
  formatTag,
  formatMatches,
  MUSIC_FORMAT_RE,
  QUALITY_SUGGESTIONS,
  type GroupableRelease,
} from "./release-groups";

let nextId = 0;
function release(title: string, over: Partial<GroupableRelease> = {}): GroupableRelease & { id: number } {
  return {
    id: nextId++,
    title,
    seeders: 10,
    size: 1_000_000,
    qualityMatch: 1,
    wasSelected: false,
    feedback: 0,
    autoBlocked: false,
    ...over,
  };
}

describe("parseEpisodeKey", () => {
  it("parses SxxEyy in its common spellings", () => {
    expect(parseEpisodeKey("Futurama S14E04 1080p WEB")).toEqual({ kind: "episode", season: 14, episode: 4 });
    expect(parseEpisodeKey("show s01e1")).toEqual({ kind: "episode", season: 1, episode: 1 });
    expect(parseEpisodeKey("Show.S14.E04.1080p")).toEqual({ kind: "episode", season: 14, episode: 4 });
    expect(parseEpisodeKey("Show_S14_E04")).toEqual({ kind: "episode", season: 14, episode: 4 });
  });

  it("parses the NxNN cross form", () => {
    expect(parseEpisodeKey("Show 1x04 HDTV")).toEqual({ kind: "episode", season: 1, episode: 4 });
  });

  it("does not mistake resolutions or codecs for episodes", () => {
    expect(parseEpisodeKey("Movie 1920x1080 x264 BluRay")).toBeNull();
    expect(parseEpisodeKey("Movie 2020 1080p x265")).toBeNull();
  });

  it("detects season packs", () => {
    expect(parseEpisodeKey("Futurama S14 1080p Complete")).toEqual({ kind: "season-pack", season: 14 });
    expect(parseEpisodeKey("Futurama Season 14 WEB-DL")).toEqual({ kind: "season-pack", season: 14 });
    expect(parseEpisodeKey("Futurama Complete Series")).toEqual({ kind: "season-pack", season: null });
  });

  it("returns null for movie titles", () => {
    expect(parseEpisodeKey("The Furious (2025) 1080p BluRay")).toBeNull();
  });
});

describe("groupReleases", () => {
  it("groups by episode, newest first, with packs and other trailing", () => {
    const grouped = groupReleases(
      [
        release("Show S14E03 1080p"),
        release("Show S14E04 1080p"),
        release("Show S14 Complete 1080p"),
        release("Show S14E04 720p"),
        release("Some unparsable extra"),
      ],
      "seeders",
      "tv",
    );
    if (grouped.mode !== "grouped") throw new Error("expected grouped");
    expect(grouped.groups.map((g) => g.label)).toEqual(["S14E04", "S14E03", "Season packs", "Other"]);
    expect(grouped.groups[0].results).toHaveLength(2);
  });

  it("orders seasons above episode numbers", () => {
    const grouped = groupReleases(
      [release("Show S13E09"), release("Show S14E01"), release("Show S13E10")],
      "seeders",
      "tv",
    );
    if (grouped.mode !== "grouped") throw new Error("expected grouped");
    expect(grouped.groups.map((g) => g.label)).toEqual(["S14E01", "S13E10", "S13E09"]);
  });

  it("falls back to a flat list when fewer than two episodes parse", () => {
    const grouped = groupReleases(
      [release("The Furious (2025) 1080p"), release("The Furious (2025) 720p")],
      "seeders",
      "tv",
    );
    expect(grouped.mode).toBe("flat");
  });

  it("marks downloaded groups and collapses them by default", () => {
    const grouped = groupReleases(
      [
        release("Show S14E04 1080p"),
        release("Show S14E03 1080p", { wasSelected: true }),
        release("Show S14 Complete"),
      ],
      "seeders",
      "tv",
    );
    if (grouped.mode !== "grouped") throw new Error("expected grouped");
    const [e04, e03, packs] = grouped.groups;
    expect(e04).toMatchObject({ downloaded: false, collapsedByDefault: false });
    expect(e03).toMatchObject({ downloaded: true, collapsedByDefault: true });
    expect(packs).toMatchObject({ downloaded: false, collapsedByDefault: true });
  });

  it("sorts within groups and sinks rejected rows last", () => {
    const strong = release("Show S14E04 A", { seeders: 100 });
    const blocked = release("Show S14E04 B", { seeders: 500, autoBlocked: true });
    const weak = release("Show S14E04 C", { seeders: 5 });
    const other = release("Show S14E03 D");
    const grouped = groupReleases([weak, blocked, strong, other], "seeders", "tv");
    if (grouped.mode !== "grouped") throw new Error("expected grouped");
    expect(grouped.groups[0].results.map((r) => r.title)).toEqual([
      "Show S14E04 A",
      "Show S14E04 C",
      "Show S14E04 B",
    ]);
  });
});

describe("partitionRejectedLast", () => {
  it("keeps order stable while sinking downvoted and blocked rows", () => {
    const rows = [
      release("a", { feedback: -1 }),
      release("b"),
      release("c", { autoBlocked: true }),
      release("d"),
    ];
    expect(partitionRejectedLast(rows).map((r) => r.title)).toEqual(["b", "d", "a", "c"]);
  });
});

describe("resolutionTag", () => {
  it("extracts the resolution and normalizes 4K", () => {
    expect(resolutionTag("Show S14E04 1080p WEB")).toBe("1080p");
    expect(resolutionTag("Movie 2160p HDR")).toBe("2160p");
    expect(resolutionTag("Movie 4K Remux")).toBe("2160p");
    expect(resolutionTag("Show 720p HDTV")).toBe("720p");
  });

  it("labels unparsable and legacy codecs SD", () => {
    expect(resolutionTag("Show S14E04 XviD AFG")).toBe("SD");
    expect(resolutionTag("Show S14E04 WEB")).toBe("SD");
  });
});

describe("resolutionMatches", () => {
  it("matches case-insensitively and treats 4K as 2160p", () => {
    expect(resolutionMatches("1080p", "1080p")).toBe(true);
    expect(resolutionMatches("2160p", "4K")).toBe(true);
    expect(resolutionMatches("720p", "1080p")).toBe(false);
  });
});

describe("seederTone", () => {
  it("maps thresholds to tones", () => {
    expect(seederTone(50)).toBe("done");
    expect(seederTone(49)).toBe("warn");
    expect(seederTone(5)).toBe("warn");
    expect(seederTone(4)).toBe("error");
  });
});

describe("formatTag", () => {
  it("keeps resolution tags for video kinds", () => {
    expect(formatTag("Show S14E04 1080p WEB", "tv")).toBe("1080p");
    expect(formatTag("Movie 4K Remux", "movie")).toBe("2160p");
  });

  it("extracts music formats", () => {
    expect(formatTag("Radiohead - OK Computer (1997) [FLAC]", "music")).toBe("FLAC");
    expect(formatTag("Radiohead - OK Computer MP3 320", "music")).toBe("MP3");
    expect(formatTag("Radiohead - OK Computer (1997)", "music")).toBeNull();
  });

  it("returns null for other and legacy kinds", () => {
    expect(formatTag("ubuntu-24.04.1-desktop-amd64.iso", "other")).toBeNull();
    expect(formatTag("Frankenstein EPUB", "book")).toBeNull();
  });
});

describe("formatMatches", () => {
  it("matches music formats case-insensitively", () => {
    expect(formatMatches("FLAC", "flac", "music")).toBe(true);
    expect(formatMatches("320", "FLAC", "music")).toBe(false);
  });

  it("keeps the video 4K alias", () => {
    expect(formatMatches("2160p", "4K", "movie")).toBe(true);
  });

  it("never matches a null tag", () => {
    expect(formatMatches(null, "1080p", "other")).toBe(false);
  });
});

describe("groupReleases by kind", () => {
  it("groups music by album with packs collapsed", () => {
    const grouped = groupReleases(
      [
        release("Radiohead - OK Computer (1997) [FLAC]"),
        release("Radiohead - OK Computer (1997) MP3 320"),
        release("Radiohead - In Rainbows (2007) FLAC"),
        release("Radiohead Discography 1993-2016 FLAC"),
      ],
      "seeders",
      "music",
    );
    if (grouped.mode !== "grouped") throw new Error("expected grouped");
    expect(grouped.groups.map((g) => g.label)).toEqual(["In Rainbows", "OK Computer", "Packs"]);
    expect(grouped.groups[1].results).toHaveLength(2);
    expect(grouped.groups[2].collapsedByDefault).toBe(true);
  });

  it("falls back to flat for a single album", () => {
    const grouped = groupReleases(
      [release("Radiohead - OK Computer (1997) [FLAC]"), release("Radiohead - OK Computer V0")],
      "seeders",
      "music",
    );
    expect(grouped.mode).toBe("flat");
  });

  it("keeps movie and other kinds flat even with episode-looking titles", () => {
    const rows = [release("Show S14E04 1080p"), release("Show S14E03 1080p")];
    expect(groupReleases(rows, "seeders", "movie").mode).toBe("flat");
    expect(groupReleases(rows, "seeders", "other").mode).toBe("flat");
  });
});

// The suggestions the watchlist modals offer are only useful if the parsers in
// this file can read them back off a release title. Anything offered here that
// formatTag can't recognize would silently never match.
describe("QUALITY_SUGGESTIONS", () => {
  it("offers only music formats the parser recognizes", () => {
    for (const { value } of QUALITY_SUGGESTIONS.music!) {
      expect(MUSIC_FORMAT_RE.test(`Artist - Album [${value}]`)).toBe(true);
      expect(formatTag(`Artist - Album [${value}]`, "music")).toBe(value.toUpperCase());
    }
  });

  it("offers only resolutions the parser recognizes", () => {
    for (const { value } of QUALITY_SUGGESTIONS.movie!) {
      expect(resolutionTag(`Some Film 2019 ${value}`)).toBe(value);
      expect(formatMatches(resolutionTag(`Some Film 2019 ${value}`), value, "movie")).toBe(true);
    }
  });

  it("matches a 2160p release against the 4K spelling a user may type", () => {
    expect(formatMatches(resolutionTag("Some Film 2160p"), "4K", "movie")).toBe(true);
  });

  it("gives movie and tv the same ladder and leaves other kinds unsuggested", () => {
    expect(QUALITY_SUGGESTIONS.tv).toEqual(QUALITY_SUGGESTIONS.movie);
    expect(QUALITY_SUGGESTIONS.other).toBeUndefined();
  });
});
