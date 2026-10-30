import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { backoffDelay, startPolling, type VisibilityTarget } from "./visibility-poller";

class FakeDoc implements VisibilityTarget {
  hidden = false;
  private fns = new Set<() => void>();
  addEventListener(_type: "visibilitychange", fn: () => void) {
    this.fns.add(fn);
  }
  removeEventListener(_type: "visibilitychange", fn: () => void) {
    this.fns.delete(fn);
  }
  setHidden(hidden: boolean) {
    this.hidden = hidden;
    for (const fn of [...this.fns]) fn();
  }
  get listenerCount() {
    return this.fns.size;
  }
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("startPolling", () => {
  it("runs once right away, then every interval", async () => {
    const tick = vi.fn();
    startPolling(tick, { intervalMs: 1000, doc: new FakeDoc() });
    expect(tick).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(tick).toHaveBeenCalledTimes(4);
  });

  it("still loads once when the tab starts hidden", async () => {
    const doc = new FakeDoc();
    doc.hidden = true;
    const tick = vi.fn();
    startPolling(tick, { intervalMs: 1000, doc });
    await vi.advanceTimersByTimeAsync(5000);
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it("skips ticks while hidden and runs immediately when visible again", async () => {
    const doc = new FakeDoc();
    const tick = vi.fn();
    startPolling(tick, { intervalMs: 1000, doc });
    await vi.advanceTimersByTimeAsync(0);
    doc.setHidden(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(tick).toHaveBeenCalledTimes(1);
    doc.setHidden(false);
    expect(tick).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(999);
    expect(tick).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(tick).toHaveBeenCalledTimes(3);
  });

  it("does not start a second tick while one is still in flight", async () => {
    const doc = new FakeDoc();
    let finish!: () => void;
    const tick = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    startPolling(tick, { intervalMs: 1000, doc });
    await vi.advanceTimersByTimeAsync(0);
    doc.setHidden(true);
    doc.setHidden(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(tick).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(1000);
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it("waits for a slow tick before counting the next interval", async () => {
    const tick = vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 1500)));
    startPolling(tick, { intervalMs: 1000, doc: new FakeDoc() });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2499);
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it("keeps polling after a tick throws or rejects", async () => {
    const tick = vi.fn()
      .mockImplementationOnce(() => { throw new Error("sync"); })
      .mockImplementationOnce(() => Promise.reject(new Error("async")))
      .mockImplementation(() => {});
    startPolling(tick, { intervalMs: 1000, doc: new FakeDoc() });
    await vi.advanceTimersByTimeAsync(2000);
    expect(tick).toHaveBeenCalledTimes(3);
  });

  it("reads the interval before each wait so callers can back off", async () => {
    const delays = [1000, 4000];
    const tick = vi.fn();
    startPolling(tick, { intervalMs: () => delays.shift() ?? 1000, doc: new FakeDoc() });
    await vi.advanceTimersByTimeAsync(1000);
    expect(tick).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3999);
    expect(tick).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(tick).toHaveBeenCalledTimes(3);
  });

  it("runs only the first load when the interval is zero", async () => {
    const doc = new FakeDoc();
    const tick = vi.fn();
    startPolling(tick, { intervalMs: 0, doc });
    await vi.advanceTimersByTimeAsync(10_000);
    doc.setHidden(true);
    doc.setHidden(false);
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it("stops ticking and listening once stopped, even mid-tick", async () => {
    const doc = new FakeDoc();
    let finish!: () => void;
    const tick = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const stop = startPolling(tick, { intervalMs: 1000, doc });
    await vi.advanceTimersByTimeAsync(0);
    stop();
    finish();
    doc.setHidden(true);
    doc.setHidden(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(tick).toHaveBeenCalledTimes(1);
    expect(doc.listenerCount).toBe(0);
  });

  it("never runs when stopped before the first load", async () => {
    const tick = vi.fn();
    startPolling(tick, { intervalMs: 1000, doc: new FakeDoc() })();
    await vi.advanceTimersByTimeAsync(5000);
    expect(tick).not.toHaveBeenCalled();
  });

  it("treats a missing document as always visible", async () => {
    const tick = vi.fn();
    startPolling(tick, { intervalMs: 1000, doc: null });
    await vi.advanceTimersByTimeAsync(2000);
    expect(tick).toHaveBeenCalledTimes(3);
  });
});

describe("backoffDelay", () => {
  it("doubles per consecutive failure up to the cap", () => {
    expect(backoffDelay(2000, 0)).toBe(2000);
    expect(backoffDelay(2000, 1)).toBe(4000);
    expect(backoffDelay(2000, 3)).toBe(16000);
    expect(backoffDelay(2000, 4)).toBe(30000);
    expect(backoffDelay(2000, 50)).toBe(30000);
  });

  it("never shortens an interval that is already above the cap", () => {
    expect(backoffDelay(60_000, 2)).toBe(60_000);
  });
});

describe("startPolling before the first load", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the first load when the tab hides before it runs", async () => {
    const doc = new FakeDoc();
    const tick = vi.fn();
    startPolling(tick, { intervalMs: 0, doc });
    doc.setHidden(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(1);
  });
});
