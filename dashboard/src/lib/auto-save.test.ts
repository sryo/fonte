// Runs via root `npm test`; imports stay relative (nothing maps "@/" outside Next).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createAutoSaveQueue, textDraftCommit, type SaveStatus } from "./auto-save";

function deferred() {
  let resolve!: () => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup() {
  const statuses: Record<string, SaveStatus> = {};
  const settled: string[] = [];
  const queue = createAutoSaveQueue({
    onStatus: (key, status) => {
      statuses[key] = status;
    },
    onSettled: (key) => settled.push(key),
  });
  return { queue, statuses, settled };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createAutoSaveQueue", () => {
  it("goes saving, saved, then back to idle", async () => {
    const { queue, statuses, settled } = setup();
    const save = deferred();
    queue.commit("dht", () => save.promise);
    expect(statuses.dht).toEqual({ state: "saving" });

    save.resolve();
    await flush();
    expect(statuses.dht).toEqual({ state: "saved" });
    expect(settled).toEqual(["dht"]);

    await vi.advanceTimersByTimeAsync(2000);
    expect(statuses.dht).toEqual({ state: "idle" });
  });

  it("keeps showing saving while a newer commit for the same key is in flight", async () => {
    const { queue, statuses, settled } = setup();
    const first = deferred();
    const second = deferred();
    queue.commit("dht", () => first.promise);
    queue.commit("dht", () => second.promise);

    first.resolve();
    await flush();
    expect(statuses.dht).toEqual({ state: "saving" });
    expect(settled).toEqual([]);

    second.resolve();
    await flush();
    expect(statuses.dht).toEqual({ state: "saved" });
    expect(settled).toEqual(["dht"]);
  });

  it("does not let an earlier save's timer wipe a later error", async () => {
    const { queue, statuses } = setup();
    const first = deferred();
    const second = deferred();
    queue.commit("max_concurrent", () => first.promise);
    queue.commit("max_concurrent", () => second.promise);

    first.resolve();
    await flush();
    second.reject(new Error("Transmission RPC: invalid argument"));
    await flush();
    expect(statuses.max_concurrent).toEqual({ state: "error", message: "Transmission RPC: invalid argument" });

    await vi.advanceTimersByTimeAsync(5000);
    expect(statuses.max_concurrent).toEqual({ state: "error", message: "Transmission RPC: invalid argument" });
  });

  it("does not let a stale saved timer clear a save started after it", async () => {
    const { queue, statuses } = setup();
    queue.commit("dht", () => Promise.resolve());
    await flush();
    expect(statuses.dht).toEqual({ state: "saved" });

    await vi.advanceTimersByTimeAsync(1500);
    const slow = deferred();
    queue.commit("dht", () => slow.promise);
    await vi.advanceTimersByTimeAsync(1000);
    expect(statuses.dht).toEqual({ state: "saving" });
  });

  it("runs saves one at a time, in commit order", async () => {
    const { queue } = setup();
    const order: string[] = [];
    const first = deferred();
    queue.commit("a", async () => {
      order.push("a start");
      await first.promise;
      order.push("a end");
    });
    queue.commit("b", async () => {
      order.push("b start");
    });
    await flush();
    expect(order).toEqual(["a start"]);
    first.resolve();
    await flush();
    expect(order).toEqual(["a start", "a end", "b start"]);
  });

  it("falls back to a generic message for an empty error", async () => {
    const { queue, statuses } = setup();
    queue.commit("dht", () => Promise.reject(new Error("")));
    await flush();
    expect(statuses.dht).toEqual({ state: "error", message: "Save failed" });
  });

  it("lets a caller wait for queued saves, so a test runs against saved values", async () => {
    const { queue } = setup();
    const save = deferred();
    queue.commit("jackett_api_key", () => save.promise);
    let idle = false;
    void queue.whenIdle().then(() => {
      idle = true;
    });
    await flush();
    expect(idle).toBe(false);
    save.resolve();
    await flush();
    expect(idle).toBe(true);
  });

  it("stops status updates after dispose", async () => {
    const { queue, statuses } = setup();
    queue.commit("dht", () => Promise.resolve());
    await flush();
    queue.dispose();
    await vi.advanceTimersByTimeAsync(2000);
    expect(statuses.dht).toEqual({ state: "saved" });
  });
});

describe("textDraftCommit", () => {
  it("trims pasted whitespace off the committed value", () => {
    expect(textDraftCommit("  abc123\n", "")).toBe("abc123");
  });

  it("skips the save when only surrounding whitespace changed", () => {
    expect(textDraftCommit("abc123 ", "abc123")).toBeNull();
    expect(textDraftCommit("abc123", "abc123")).toBeNull();
  });

  it("allows clearing a value", () => {
    expect(textDraftCommit("   ", "abc123")).toBe("");
  });
});
