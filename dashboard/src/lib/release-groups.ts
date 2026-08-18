// Episode grouping, resolution tags, and seeder health for watchlist results.
// Imports stay relative (no "@/") so the root vitest run can resolve them.

import { sortReleases, type ReleaseSortKey, type ReleaseSortable } from "./release-order";
import { type Tone } from "./status";

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
): GroupedReleases<T> {
  const arrange = (rs: T[]) => partitionRejectedLast(sortReleases(rs, sortKey));

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
