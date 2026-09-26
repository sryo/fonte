export function parseNumberDraft(
  draft: string,
  { integer, min }: { integer: boolean; min?: number }
): number | null {
  if (!draft.trim()) return null;
  const parsed = Number(draft);
  if (!Number.isFinite(parsed)) return null;
  const n = integer ? Math.round(parsed) : parsed;
  return min !== undefined ? Math.max(min, n) : n;
}
