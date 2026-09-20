// Up-arrow recall for the chat composers, shell style: the keys only take
// over while the field is empty or still holds an untouched recalled entry,
// so caret movement inside a draft is never hijacked.

import { isTextRow } from "./agent-activity";

interface SentRow {
  role: string;
  kind?: string;
  content: string;
}

/** What the person sent, oldest first, consecutive repeats collapsed. */
export function buildSentHistory(rows: SentRow[]): string[] {
  const entries: string[] = [];
  for (const row of rows) {
    if (row.role !== "user" || !isTextRow(row)) continue;
    const text = row.content.trim();
    if (text && entries[entries.length - 1] !== text) entries.push(text);
  }
  return entries;
}

export function isBrowsingHistory(entries: string[], index: number | null, value: string): boolean {
  return index !== null && entries[index] === value;
}

/** The composer after one key press, or null when the key keeps its normal meaning. */
export function stepHistory(
  entries: string[],
  index: number | null,
  value: string,
  key: string
): { index: number | null; value: string } | null {
  const at = isBrowsingHistory(entries, index, value) ? index : null;
  if (key === "ArrowUp") {
    if (at !== null) {
      const older = Math.max(0, at - 1);
      return { index: older, value: entries[older] };
    }
    if (value !== "" || entries.length === 0) return null;
    const newest = entries.length - 1;
    return { index: newest, value: entries[newest] };
  }
  if (at === null || (key !== "ArrowDown" && key !== "Escape")) return null;
  if (key === "ArrowDown" && at < entries.length - 1) {
    return { index: at + 1, value: entries[at + 1] };
  }
  return { index: null, value: "" };
}
