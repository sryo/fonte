// Episode grouping, resolution tags, and seeder health for watchlist results.
// Imports stay relative (no "@/") so the root vitest run can resolve them.

import { sortReleases, type ReleaseSortKey, type ReleaseSortable } from "./release-order";
import { type Tone } from "./status";
import type { MediaType } from "./api-types";

export interface GroupableRelease extends ReleaseSortable {
  wasSelected: boolean;
  feedback: -1 | 0 | 1;
  autoBlocked: boolean;
}

export type EpisodeKey =
  | { kind: "episode"; season: number; episode: number }
  | { kind: "season-pack"; season: number | null }
  | null;

const EPISODE_RE = /(?<![a-z0-9])S(\d{1,2})[\s._-]?E(\d{1,3})(?![0-9])/i;
const CROSS_RE = /\b(\d{1,2})x(\d{2,3})\b/;
const BARE_SEASON_RE = /(?<![a-z0-9])S(\d{1,2})(?![a-z0-9])(?![\s._-]?E\d)/i;
const SEASON_WORD_RE = /(?<![a-z])season[\s._-]?(\d{1,2})(?![0-9])/i;
const COMPLETE_RE = /\bcomplete\b/i;

export function parseEpisodeKey(title: string): EpisodeKey {
  const episode = EPISODE_RE.exec(title);
  if (episode) {
    return { kind: "episode", season: parseInt(episode[1], 10), episode: parseInt(episode[2], 10) };
  }
  const cross = CROSS_RE.exec(title);
  if (cross) {
    return { kind: "episode", season: parseInt(cross[1], 10), episode: parseInt(cross[2], 10) };
  }
  const bare = BARE_SEASON_RE.exec(title);
  if (bare) {
    return { kind: "season-pack", season: parseInt(bare[1], 10) };
  }
  const word = SEASON_WORD_RE.exec(title);
  if (word) {
    return { kind: "season-pack", season: parseInt(word[1], 10) };
  }
  if (COMPLETE_RE.test(title)) {
    return { kind: "season-pack", season: null };
  }
  return null;
}

export interface ReleaseGroup<T> {
  key: string;
  label: string;
  downloaded: boolean;
  collapsedByDefault: boolean;
  results: T[];
}

export type GroupedReleases<T> =
  | { mode: "grouped"; groups: ReleaseGroup<T>[] }
  | { mode: "flat"; results: T[] };

export function partitionRejectedLast<T extends { feedback: -1 | 0 | 1; autoBlocked: boolean }>(
  sorted: T[],
): T[] {
  const rejected = (r: T) => r.feedback === -1 || r.autoBlocked;
  return [...sorted.filter((r) => !rejected(r)), ...sorted.filter(rejected)];
}

export function groupReleases<T extends GroupableRelease>(
  results: T[],
  sortKey: ReleaseSortKey,
  kind: MediaType,
): GroupedReleases<T> {
  const arrange = (rs: T[]) => partitionRejectedLast(sortReleases(rs, sortKey));

  if (kind === "music") return groupByAlbum(results, arrange);
  if (kind !== "tv") return { mode: "flat", results: arrange(results) };

  const episodes = new Map<string, { season: number; episode: number; results: T[] }>();
  const packs: T[] = [];
  const other: T[] = [];
  for (const r of results) {
    const key = parseEpisodeKey(r.title);
    if (key?.kind === "episode") {
      const id = `s${key.season}e${key.episode}`;
      const bucket = episodes.get(id) ?? { season: key.season, episode: key.episode, results: [] };
      bucket.results.push(r);
      episodes.set(id, bucket);
    } else if (key?.kind === "season-pack") {
      packs.push(r);
    } else {
      other.push(r);
    }
  }

  if (episodes.size < 2) {
    return { mode: "flat", results: arrange(results) };
  }

  const toGroup = (key: string, label: string, rs: T[], seasonPack: boolean): ReleaseGroup<T> => {
    const downloaded = rs.some((r) => r.wasSelected);
    return {
      key,
      label,
      downloaded,
      collapsedByDefault: downloaded || seasonPack,
      results: arrange(rs),
    };
  };

  const groups = [...episodes.entries()]
    .sort(([, a], [, b]) => b.season - a.season || b.episode - a.episode)
    .map(([id, bucket]) =>
      toGroup(
        id,
        `S${String(bucket.season).padStart(2, "0")}E${String(bucket.episode).padStart(2, "0")}`,
        bucket.results,
        false,
      ),
    );
  if (packs.length > 0) groups.push(toGroup("season-packs", "Season packs", packs, true));
  if (other.length > 0) groups.push(toGroup("other", "Other", other, false));

  return { mode: "grouped", groups };
}

export type ResolutionLabel = "2160p" | "1080p" | "720p" | "480p" | "SD";

export function resolutionTag(title: string): ResolutionLabel {
  const res = /\b(2160p|1080p|720p|480p)\b/i.exec(title);
  if (res) return res[1].toLowerCase() as ResolutionLabel;
  if (/\b4k\b/i.test(title)) return "2160p";
  return "SD";
}

export function resolutionMatches(tag: ResolutionLabel, wantedQuality: string): boolean {
  const wanted = wantedQuality.trim().toLowerCase();
  return tag === (wanted === "4k" ? "2160p" : wanted);
}

export function seederTone(seeders: number): Tone {
  if (seeders >= 50) return "done";
  if (seeders >= 5) return "warn";
  return "error";
}

export interface QualitySuggestion {
  value: string;
  hint?: string;
}

// One list drives both the suggestions the modals offer and the regexes that
// read a format back off a release title, so the two can't drift apart.
const MUSIC_FORMATS: QualitySuggestion[] = [
  { value: "FLAC", hint: "lossless" },
  { value: "ALAC", hint: "lossless" },
  { value: "APE", hint: "lossless" },
  { value: "320", hint: "MP3 constant rate" },
  { value: "V0", hint: "MP3 variable, best" },
  { value: "V2", hint: "MP3 variable" },
  { value: "MP3" },
  { value: "AAC" },
];
const MUSIC_ALTERNATION = MUSIC_FORMATS.map(f => f.value).join("|");

export const MUSIC_FORMAT_RE = new RegExp(String.raw`\b(${MUSIC_ALTERNATION})\b`, "i");
const MUSIC_PACK_RE = /\b(discography|collection|complete)\b/i;

// Every resolution resolutionTag can name, loudest first. SD is what it falls
// back to, never something to ask for.
const VIDEO_QUALITIES: QualitySuggestion[] = [
  { value: "2160p", hint: "4K" },
  { value: "1080p" },
  { value: "720p" },
  { value: "480p" },
];

export const QUALITY_SUGGESTIONS: Partial<Record<MediaType, QualitySuggestion[]>> = {
  movie: VIDEO_QUALITIES,
  tv: VIDEO_QUALITIES,
  music: MUSIC_FORMATS,
};

function albumCut(title: string): string {
  return title
    .replace(/^.{1,60}?\s-\s/, "")
    .replace(/\s*[([]\s*(19|20)\d{2}\b[\s\S]*$/, "")
    .replace(new RegExp(String.raw`\s*[([][^)\]]*\b(${MUSIC_ALTERNATION})\b[\s\S]*$`, "i"), "")
    .replace(new RegExp(String.raw`\s+\b(${MUSIC_ALTERNATION}|WEB|CD|Vinyl)\b[\s\S]*$`, "i"), "")
    .trim();
}

const albumKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function groupByAlbum<T extends GroupableRelease>(
  results: T[],
  arrange: (rs: T[]) => T[],
): GroupedReleases<T> {
  const albums = new Map<string, { label: string; results: T[] }>();
  const packs: T[] = [];
  const other: T[] = [];
  for (const r of results) {
    if (MUSIC_PACK_RE.test(r.title)) {
      packs.push(r);
      continue;
    }
    const label = albumCut(r.title);
    const key = albumKey(label);
    if (!key) {
      other.push(r);
      continue;
    }
    const bucket = albums.get(key) ?? { label, results: [] };
    bucket.results.push(r);
    albums.set(key, bucket);
  }

  if (albums.size < 2) {
    return { mode: "flat", results: arrange(results) };
  }

  const toGroup = (key: string, label: string, rs: T[], pack: boolean): ReleaseGroup<T> => {
    const downloaded = rs.some((r) => r.wasSelected);
    return { key, label, downloaded, collapsedByDefault: downloaded || pack, results: arrange(rs) };
  };

  const groups = [...albums.entries()]
    .sort(([, a], [, b]) => a.label.localeCompare(b.label))
    .map(([key, bucket]) => toGroup(key, bucket.label, bucket.results, false));
  if (packs.length > 0) groups.push(toGroup("packs", "Packs", packs, true));
  if (other.length > 0) groups.push(toGroup("other", "Other", other, false));
  return { mode: "grouped", groups };
}

export function formatTag(title: string, kind: MediaType): string | null {
  if (kind === "movie" || kind === "tv") return resolutionTag(title);
  if (kind === "music") {
    const m = MUSIC_FORMAT_RE.exec(title);
    return m ? m[1].toUpperCase() : null;
  }
  return null;
}

export function formatMatches(tag: string | null, wantedQuality: string, kind: MediaType): boolean {
  if (tag === null) return false;
  if (kind === "movie" || kind === "tv") return resolutionMatches(tag as ResolutionLabel, wantedQuality);
  if (kind === "music") return tag.toLowerCase() === wantedQuality.trim().toLowerCase();
  return false;
}
