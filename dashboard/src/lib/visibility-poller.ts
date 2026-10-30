export interface VisibilityTarget {
  readonly hidden: boolean;
  addEventListener(type: "visibilitychange", fn: () => void): void;
  removeEventListener(type: "visibilitychange", fn: () => void): void;
}

type TimerId = ReturnType<typeof setTimeout> | number;

export interface PollingOptions {
  /** Read before every wait; zero or less polls once and stops. */
  intervalMs: number | (() => number);
  doc?: VisibilityTarget | null;
  setTimeout?: (fn: () => void, ms: number) => TimerId;
  clearTimeout?: (id: TimerId) => void;
}

const MAX_BACKOFF_MS = 30_000;

export function backoffDelay(baseMs: number, failures: number, maxMs = MAX_BACKOFF_MS): number {
  return Math.min(baseMs * 2 ** Math.min(failures, 30), Math.max(baseMs, maxMs));
}

/**
 * Runs tick once on the next turn, then every interval while the document is
 * visible. Hidden tabs skip ticks; becoming visible runs one right away.
 */
export function startPolling(tick: () => unknown, opts: PollingOptions): () => void {
  const doc = opts.doc === undefined ? (typeof document === "undefined" ? null : document) : opts.doc;
  const setTimer = opts.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimeout ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  const interval = typeof opts.intervalMs === "function" ? opts.intervalMs : () => opts.intervalMs as number;

  let timer: TimerId | null = null;
  let running = false;
  let stopped = false;
  let loaded = false;

  const cancel = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };

  const schedule = () => {
    cancel();
    if (stopped || doc?.hidden) return;
    const ms = interval();
    if (ms > 0) timer = setTimer(run, ms);
  };

  const run = () => {
    timer = null;
    if (stopped || running) return;
    loaded = true;
    running = true;
    let result: unknown;
    try {
      result = tick();
    } catch {}
    Promise.resolve(result)
      .catch(() => {})
      .then(() => {
        running = false;
        schedule();
      });
  };

  const onVisibility = () => {
    if (stopped || !loaded) return;
    cancel();
    if (doc?.hidden || running || interval() <= 0) return;
    run();
  };

  doc?.addEventListener("visibilitychange", onVisibility);
  timer = setTimer(run, 0);

  return () => {
    stopped = true;
    cancel();
    doc?.removeEventListener("visibilitychange", onVisibility);
  };
}
