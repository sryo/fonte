export interface EventData {
  type: string;
  timestamp: number;
  [key: string]: unknown;
}

export interface EventSourceLike {
  readonly readyState: number;
  onopen: ((e: Event) => void) | null;
  onerror: ((e: Event) => void) | null;
  addEventListener(type: string, listener: (e: MessageEvent) => void): void;
  removeEventListener(type: string, listener: (e: MessageEvent) => void): void;
  close(): void;
}

export interface EventSubscriber {
  onEvent: (event: EventData) => void;
  eventTypes: readonly string[];
  onOpen?: () => void;
  onError?: (err: Event) => void;
  /** The stream reconnected or the server could not replay what was missed, so refetch. */
  onResync?: () => void;
}

type TimerId = ReturnType<typeof setTimeout> | number;

export interface EventHubOptions {
  retryMs?: number;
  setTimeout?: (fn: () => void, ms: number) => TimerId;
  clearTimeout?: (id: TimerId) => void;
}

const CLOSED = 2;
const RESYNC_EVENT = "resync";

/** One shared stream for every subscriber; it lives while anyone is subscribed. */
export class EventHub {
  private subs = new Set<EventSubscriber>();
  private es: EventSourceLike | null = null;
  private listeners = new Map<string, (e: MessageEvent) => void>();
  private open = false;
  private openedBefore = false;
  private retryTimer: TimerId | null = null;
  private readonly retryMs: number;
  private readonly setTimer: (fn: () => void, ms: number) => TimerId;
  private readonly clearTimer: (id: TimerId) => void;

  constructor(private readonly connect: () => EventSourceLike, opts: EventHubOptions = {}) {
    this.retryMs = opts.retryMs ?? 5000;
    this.setTimer = opts.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimeout ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  }

  subscribe(sub: EventSubscriber): () => void {
    const entry = { ...sub };
    this.subs.add(entry);
    if (!this.es && this.retryTimer === null) this.start();
    else this.syncListeners();
    if (this.open) entry.onOpen?.();
    return () => {
      if (!this.subs.delete(entry)) return;
      if (this.subs.size === 0) this.stop();
      else this.syncListeners();
    };
  }

  private start() {
    const es = this.connect();
    this.es = es;
    this.listeners = new Map();
    es.onopen = () => {
      this.open = true;
      const reconnect = this.openedBefore;
      this.openedBefore = true;
      for (const sub of [...this.subs]) {
        sub.onOpen?.();
        if (reconnect) sub.onResync?.();
      }
    };
    es.onerror = (err) => {
      this.open = false;
      for (const sub of [...this.subs]) sub.onError?.(err);
      if (es.readyState === CLOSED && this.es === es) this.scheduleRetry();
    };
    es.addEventListener(RESYNC_EVENT, () => {
      for (const sub of [...this.subs]) sub.onResync?.();
    });
    this.syncListeners();
  }

  private scheduleRetry() {
    this.es?.close();
    this.es = null;
    this.retryTimer = this.setTimer(() => {
      this.retryTimer = null;
      if (this.subs.size > 0) this.start();
    }, this.retryMs);
  }

  private stop() {
    if (this.retryTimer !== null) this.clearTimer(this.retryTimer);
    this.retryTimer = null;
    this.es?.close();
    this.es = null;
    this.listeners = new Map();
    this.open = false;
    this.openedBefore = false;
  }

  private syncListeners() {
    const es = this.es;
    if (!es) return;
    const wanted = new Set<string>();
    for (const sub of this.subs) for (const type of sub.eventTypes) wanted.add(type);
    for (const [type, listener] of this.listeners) {
      if (wanted.has(type)) continue;
      es.removeEventListener(type, listener);
      this.listeners.delete(type);
    }
    for (const type of wanted) {
      if (this.listeners.has(type)) continue;
      const listener = (e: MessageEvent) => this.dispatch(type, e);
      es.addEventListener(type, listener);
      this.listeners.set(type, listener);
    }
  }

  private dispatch(type: string, e: MessageEvent) {
    let event: EventData;
    try {
      event = JSON.parse(e.data);
    } catch {
      return;
    }
    for (const sub of [...this.subs]) {
      if (!sub.eventTypes.includes(type)) continue;
      try {
        sub.onEvent(event);
      } catch {}
    }
  }
}
