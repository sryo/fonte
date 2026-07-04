// Pure ordering logic for indexer search results (watchlist releases).
// Imports stay relative (no "@/") so the root vitest run can resolve them.

export interface ReleaseSortable {
    title: string;
    seeders: number;
    size: number;
    qualityMatch: number;
    publishDate?: number;
}

export type ReleaseSortKey = "match" | "seeders" | "size" | "newest" | "name";

type Comparator = (a: ReleaseSortable, b: ReleaseSortable) => number;

const byMatch: Comparator = (a, b) => b.qualityMatch - a.qualityMatch;
const bySeeders: Comparator = (a, b) => b.seeders - a.seeders;
// Undated releases sink to the bottom rather than masquerading as newest.
const byNewest: Comparator = (a, b) => (b.publishDate ?? 0) - (a.publishDate ?? 0);
const byName: Comparator = (a, b) =>
    a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" });

export const RELEASE_SORT_COMPARATORS: Record<ReleaseSortKey, Comparator> = {
    match: (a, b) => byMatch(a, b) || bySeeders(a, b) || byName(a, b),
    seeders: (a, b) => bySeeders(a, b) || byMatch(a, b) || byName(a, b),
    size: (a, b) => b.size - a.size || bySeeders(a, b) || byName(a, b),
    newest: (a, b) => byNewest(a, b) || bySeeders(a, b) || byName(a, b),
    name: byName,
};

// "match" mirrors the server default (quality_match DESC, seeders DESC).
export const RELEASE_SORT_OPTIONS: { key: ReleaseSortKey; label: string }[] = [
    { key: "match", label: "Best match" },
    { key: "seeders", label: "Seeders" },
    { key: "size", label: "Size" },
    { key: "newest", label: "Newest" },
    { key: "name", label: "Name A–Z" },
];

export function sortReleases<T extends ReleaseSortable>(results: T[], key: ReleaseSortKey): T[] {
    return [...results].sort(RELEASE_SORT_COMPARATORS[key]);
}
