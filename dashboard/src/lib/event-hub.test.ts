import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventHub, type EventSourceLike } from "./event-hub";

class FakeEventSource implements EventSourceLike {
  static instances: FakeEventSource[] = [];
  readyState = 0;
  onopen: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  listeners = new Map<string, Set<(e: MessageEvent) => void>>();
  closed = false;

  constructor() {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }

  removeEventListener(type: string, fn: (e: MessageEvent) => void) {
    this.listeners.get(type)?.delete(fn);
  }

  close() {
    this.closed = true;
    this.readyState = 2;
  }

  types() {
    return [...this.listeners].filter(([, set]) => set.size > 0).map(([t]) => t).sort();
  }

  open() {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }

  fail(permanently = false) {
    this.readyState = permanently ? 2 : 0;
    this.onerror?.(new Event("error"));
  }

  emit(type: string, data: unknown) {
    const e = { data: typeof data === "string" ? data : JSON.stringify(data) } as MessageEvent;
    for (const fn of this.listeners.get(type) ?? []) fn(e);
  }
}

function makeHub() {
  const timers: { fn: () => void; ms: number }[] = [];
  const hub = new EventHub(() => new FakeEventSource(), {
    retryMs: 5000,
    setTimeout: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimeout: () => {},
  });
  return { hub, timers };
}

const last = () => FakeEventSource.instances[FakeEventSource.instances.length - 1];

beforeEach(() => {
  FakeEventSource.instances = [];
});

describe("EventHub", () => {
  it("opens one stream for many subscribers and closes it after the last leaves", () => {
    const { hub } = makeHub();
    const offA = hub.subscribe({ onEvent: () => {}, eventTypes: ["a"] });
    const offB = hub.subscribe({ onEvent: () => {}, eventTypes: ["b"] });
    expect(FakeEventSource.instances).toHaveLength(1);
    offA();
    expect(last().closed).toBe(false);
    offB();
    expect(last().closed).toBe(true);
  });

  it("opens a fresh stream for a subscriber that arrives after everyone left", () => {
    const { hub } = makeHub();
    hub.subscribe({ onEvent: () => {}, eventTypes: ["a"] })();
    hub.subscribe({ onEvent: () => {}, eventTypes: ["a"] });
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances[1].closed).toBe(false);
  });

  it("listens for the union of requested types, plus resync", () => {
    const { hub } = makeHub();
    const offA = hub.subscribe({ onEvent: () => {}, eventTypes: ["a", "shared"] });
    hub.subscribe({ onEvent: () => {}, eventTypes: ["b", "shared"] });
    expect(last().types()).toEqual(["a", "b", "resync", "shared"]);
    offA();
    expect(last().types()).toEqual(["b", "resync", "shared"]);
  });

  it("delivers each event only to subscribers that asked for its type", () => {
    const { hub } = makeHub();
    const a = vi.fn();
    const b = vi.fn();
    hub.subscribe({ onEvent: a, eventTypes: ["x"] });
    hub.subscribe({ onEvent: b, eventTypes: ["x", "y"] });
    last().emit("x", { type: "x", n: 1 });
    last().emit("y", { type: "y", n: 2 });
    expect(a.mock.calls).toEqual([[{ type: "x", n: 1 }]]);
    expect(b.mock.calls).toEqual([[{ type: "x", n: 1 }], [{ type: "y", n: 2 }]]);
  });

  it("skips malformed payloads and keeps going after a throwing subscriber", () => {
    const { hub } = makeHub();
    const good = vi.fn();
    hub.subscribe({ onEvent: () => { throw new Error("boom"); }, eventTypes: ["x"] });
    hub.subscribe({ onEvent: good, eventTypes: ["x"] });
    last().emit("x", "{not json");
    last().emit("x", { type: "x" });
    expect(good.mock.calls).toEqual([[{ type: "x" }]]);
  });

  it("stops delivering to an unsubscribed listener, and a second unsubscribe is a no-op", () => {
    const { hub } = makeHub();
    const a = vi.fn();
    const offA = hub.subscribe({ onEvent: a, eventTypes: ["x"] });
    hub.subscribe({ onEvent: () => {}, eventTypes: ["x"] });
    offA();
    offA();
    last().emit("x", { type: "x" });
    expect(a).not.toHaveBeenCalled();
    expect(last().closed).toBe(false);
  });

  it("fans out open and error", () => {
    const { hub } = makeHub();
    const openA = vi.fn();
    const openB = vi.fn();
    const errB = vi.fn();
    hub.subscribe({ onEvent: () => {}, eventTypes: ["x"], onOpen: openA });
    hub.subscribe({ onEvent: () => {}, eventTypes: ["x"], onOpen: openB, onError: errB });
    last().open();
    last().fail();
    expect(openA).toHaveBeenCalledTimes(1);
    expect(openB).toHaveBeenCalledTimes(1);
    expect(errB).toHaveBeenCalledTimes(1);
  });

  it("tells a subscriber joining an already open stream that it is open", () => {
    const { hub } = makeHub();
    hub.subscribe({ onEvent: () => {}, eventTypes: ["x"] });
    last().open();
    const onOpen = vi.fn();
    hub.subscribe({ onEvent: () => {}, eventTypes: ["x"], onOpen });
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("asks for a resync on reconnect, not on the first open", () => {
    const { hub } = makeHub();
    const onResync = vi.fn();
    hub.subscribe({ onEvent: () => {}, eventTypes: ["x"], onResync });
    last().open();
    expect(onResync).not.toHaveBeenCalled();
    last().fail();
    last().open();
    expect(onResync).toHaveBeenCalledTimes(1);
  });

  it("does not ask a late joiner to resync for the open it joined into", () => {
    const { hub } = makeHub();
    hub.subscribe({ onEvent: () => {}, eventTypes: ["x"] });
    last().open();
    last().fail();
    last().open();
    const onResync = vi.fn();
    hub.subscribe({ onEvent: () => {}, eventTypes: ["x"], onResync });
    expect(onResync).not.toHaveBeenCalled();
  });

  it("asks every subscriber to resync on a server resync event", () => {
    const { hub } = makeHub();
    const a = vi.fn();
    const b = vi.fn();
    hub.subscribe({ onEvent: () => {}, eventTypes: ["x"], onResync: a });
    hub.subscribe({ onEvent: () => {}, eventTypes: ["y"], onResync: b });
    last().open();
    last().emit("resync", { type: "resync" });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("reopens a stream the browser gave up on, and treats that open as a reconnect", () => {
    const { hub, timers } = makeHub();
    const onResync = vi.fn();
    const onEvent = vi.fn();
    hub.subscribe({ onEvent, eventTypes: ["x"], onResync });
    last().open();
    last().fail(true);
    expect(FakeEventSource.instances[0].closed).toBe(true);
    expect(timers.map((t) => t.ms)).toEqual([5000]);
    timers[0].fn();
    expect(FakeEventSource.instances).toHaveLength(2);
    last().open();
    expect(onResync).toHaveBeenCalledTimes(1);
    last().emit("x", { type: "x" });
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it("does not reopen once everyone has left", () => {
    const { hub, timers } = makeHub();
    const off = hub.subscribe({ onEvent: () => {}, eventTypes: ["x"] });
    last().fail(true);
    off();
    timers[0].fn();
    expect(FakeEventSource.instances).toHaveLength(1);
  });
});
