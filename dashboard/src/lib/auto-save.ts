export type SaveStatus =
  | { state: "idle" }
  | { state: "saving" }
  | { state: "saved" }
  | { state: "error"; message: string };

export const IDLE: SaveStatus = { state: "idle" };

const SAVED_MS = 2000;

export function createAutoSaveQueue({
  onStatus,
  onSettled,
}: {
  onStatus: (key: string, status: SaveStatus) => void;
  onSettled: (key: string) => void;
}) {
  let queue: Promise<void> = Promise.resolve();
  const timers: Record<string, ReturnType<typeof setTimeout>> = {};
  const latest: Record<string, number> = {};
  let seq = 0;

  return {
    commit(key: string, run: () => Promise<void>) {
      const id = ++seq;
      latest[key] = id;
      clearTimeout(timers[key]);
      onStatus(key, { state: "saving" });
      queue = queue.then(async () => {
        let failure: SaveStatus | null = null;
        try {
          await run();
        } catch (err) {
          failure = { state: "error", message: (err as Error)?.message || "Save failed" };
        }
        if (latest[key] !== id) return;
        onSettled(key);
        if (failure) {
          onStatus(key, failure);
          return;
        }
        onStatus(key, { state: "saved" });
        timers[key] = setTimeout(() => onStatus(key, IDLE), SAVED_MS);
      });
    },
    whenIdle() {
      return queue;
    },
    dispose() {
      Object.values(timers).forEach(clearTimeout);
    },
  };
}

export function textDraftCommit(draft: string, committed: string): string | null {
  const next = draft.trim();
  return next === committed ? null : next;
}
