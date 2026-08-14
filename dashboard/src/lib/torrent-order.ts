// Pure ordering + filtering logic for the home page Downloads lane.
// Imports stay relative (no "@/") so the root vitest run can resolve them.

import type { TorrentRecord } from "./api-types";

export type SortKey = "status" | "recent" | "name" | "progress" | "queue";
export type PillKey = "all" | "active" | "seeding" | "paused" | "finished" | "issues" | "watching";

export function isStalled(t: TorrentRecord): boolean {
  return t.status === "downloading" && t.stalledSince != null;
}

export function isFinished(t: TorrentRecord): boolean {
  return t.status === "seeding" || t.status === "completed";
}

/** An add that failed before any data arrived — nothing on disk to lose. */
export function isFailedAdd(t: TorrentRecord): boolean {
  return t.status === "error" && t.progress === 0;
}

/** Timestamp of the torrent's latest lifecycle event. */
export function recency(t: TorrentRecord): number {
  return t.completedAt ?? t.addedAt ?? 0;
}

// Attention first (errors, stalls), then fresh activity (a just-dropped
// .torrent must surface near the top), then the steady states, done last.
const STATUS_RANK: Record<string, number> = {
  error: 0,
  // stalled (rank 1) is derived, not a status — see statusGroupRank
  adding: 2,
  checking: 3,
  downloading: 4,
  queued: 5,
  paused: 6,
  seeding: 7,
  completed: 8,
};

export function statusGroupRank(t: TorrentRecord): number {
  if (isStalled(t)) return 1;
  return STATUS_RANK[t.status] ?? 9;
}

type Comparator = (a: TorrentRecord, b: TorrentRecord) => number;

const byId: Comparator = (a, b) => a.id.localeCompare(b.id);
const byRecency: Comparator = (a, b) => recency(b) - recency(a);
// Torrents the daemon hasn't positioned yet sink to the end.
const byQueue: Comparator = (a, b) =>
  (a.queuePosition ?? Number.MAX_SAFE_INTEGER) - (b.queuePosition ?? Number.MAX_SAFE_INTEGER);

export const SORT_COMPARATORS: Record<SortKey, Comparator> = {
  status: (a, b) => statusGroupRank(a) - statusGroupRank(b) || byRecency(a, b) || byId(a, b),
  recent: (a, b) => byRecency(a, b) || byId(a, b),
  name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }) || byId(a, b),
  progress: (a, b) => b.progress - a.progress || byRecency(a, b) || byId(a, b),
  queue: (a, b) => byQueue(a, b) || byRecency(a, b) || byId(a, b),
};

export function sortTorrents(torrents: TorrentRecord[], key: SortKey): TorrentRecord[] {
  return [...torrents].sort(SORT_COMPARATORS[key]);
}

/** `ids` with the item at `from` moved to `to`. */
export function moveId(ids: string[], from: number, to: number): string[] {
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Optimistic overlay: rewrite queuePosition so `orderedIds` becomes the
    queue order, until the server echoes real positions. */
export function applyQueuePositions(torrents: TorrentRecord[], orderedIds: string[]): TorrentRecord[] {
  const pos = new Map(orderedIds.map((id, i) => [id, i]));
  return torrents.map((t) => {
    const p = pos.get(t.id);
    return p === undefined ? t : { ...t, queuePosition: p };
  });
}

/** Absolute Transmission queuePosition that lands the item at `index` of
    `orderedIds` right after its preceding neighbor. Neighbor-based so it
    stays correct when a pill filter hides part of the queue. */
export function queueDropPosition(
  byId: Map<string, TorrentRecord>,
  orderedIds: string[],
  index: number
): number {
  if (index <= 0) return 0;
  const prev = byId.get(orderedIds[index - 1]);
  const moved = byId.get(orderedIds[index]);
  const prevPos = prev?.queuePosition ?? index - 1;
  const curPos = moved?.queuePosition;
  // Moving up past prev: prev keeps its slot, land right after it. Moving
  // down: removing the card first shifts prev one earlier, so prev's old
  // position is the landing slot.
  return curPos !== undefined && curPos < prevPos ? prevPos : prevPos + 1;
}

export type TorrentPillKey = Exclude<PillKey, "all" | "watching">;

export const TORRENT_PILL_PREDICATES: Record<TorrentPillKey, (t: TorrentRecord) => boolean> = {
  active: (t) => t.status === "downloading" || t.status === "queued" || t.status === "checking" || t.status === "adding",
  seeding: (t) => t.status === "seeding",
  paused: (t) => t.status === "paused",
  finished: isFinished,
  issues: (t) => t.status === "error" || isStalled(t),
};

export const PILL_DEFS: { key: PillKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "seeding", label: "Seeding" },
  { key: "paused", label: "Paused" },
  { key: "finished", label: "Finished" },
  { key: "watching", label: "Watching" },
  { key: "issues", label: "Issues" },
];

/** Pills the user can show/hide via the "+" configurator. All is permanent; Issues is always-on. */
export const CONFIGURABLE_PILLS: PillKey[] = ["active", "seeding", "paused", "finished", "watching"];

export const DEFAULT_VISIBLE_PILLS: PillKey[] = [...CONFIGURABLE_PILLS];

export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "status", label: "Status" },
  { key: "recent", label: "Recent" },
  { key: "name", label: "Name A–Z" },
  { key: "progress", label: "Progress" },
  { key: "queue", label: "Queue" },
];

export function countTorrentPills(torrents: TorrentRecord[]): Record<TorrentPillKey, number> {
  const counts: Record<TorrentPillKey, number> = { active: 0, seeding: 0, paused: 0, finished: 0, issues: 0 };
  for (const t of torrents) {
    for (const key of Object.keys(counts) as TorrentPillKey[]) {
      if (TORRENT_PILL_PREDICATES[key](t)) counts[key]++;
    }
  }
  return counts;
}
