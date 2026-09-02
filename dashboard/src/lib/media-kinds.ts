// Kind vocabulary shared by the add and edit watchlist modals.

import type { MediaType } from "./api-types";
import { QUALITY_SUGGESTIONS } from "./release-groups";

// Only optimized-for kinds get a segment; everything else is Other, which
// searches every category and matches on the title alone.
export const MEDIA_TYPES: { value: MediaType; label: string }[] = [
  { value: "movie", label: "Movie" },
  { value: "tv", label: "TV" },
  { value: "music", label: "Music" },
  { value: "other", label: "Other" },
];

// Legacy kinds stay editable on entries that already carry them.
export const LEGACY_LABELS: Partial<Record<MediaType, string>> = {
  game: "Game",
  book: "Book",
  app: "App",
};

export const VIDEO_DEFAULT_QUALITY = "1080p";
export const MUSIC_DEFAULT_QUALITY = "FLAC";

/** TMDB only knows film and television, and those are also the kinds whose
    quality ladder is a resolution rather than a format. */
export function isVideoKind(kind: MediaType): boolean {
  return kind === "movie" || kind === "tv";
}

export function defaultQuality(kind: MediaType, videoQuality = VIDEO_DEFAULT_QUALITY): string {
  if (isVideoKind(kind)) return videoQuality;
  return kind === "music" ? MUSIC_DEFAULT_QUALITY : "";
}

/** Other matches on the title alone, and the legacy kinds have no vocabulary
    to suggest — neither gets a quality field in either modal. */
export function kindHasQuality(kind: MediaType): boolean {
  return Boolean(QUALITY_SUGGESTIONS[kind]);
}

/** A year narrows the query and hard-filters results, which sinks a search for
    a kind whose releases aren't named by year. Mirrors searchYear on the server. */
export function kindUsesYear(kind: MediaType): boolean {
  return kind !== "other";
}
