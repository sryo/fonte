// Runs via root `npm test`; imports stay relative (nothing maps "@/" outside Next).
import { describe, it, expect, vi } from "vitest";
import { retryUntil } from "./retry";

const noSleep = () => Promise.resolve();

describe("retryUntil", () => {
  it("resolves with the first success", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("down")).mockRejectedValueOnce(new Error("down")).mockResolvedValue("up");
    await expect(retryUntil(fn, { attempts: 5, delayMs: 10, sleep: noSleep })).resolves.toBe("up");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("gives up with the last error after the allowed attempts", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("still down"));
    await expect(retryUntil(fn, { attempts: 3, delayMs: 10, sleep: noSleep })).rejects.toThrow("still down");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("waits between attempts, not after the last", async () => {
    const sleep = vi.fn(noSleep);
    await retryUntil(vi.fn().mockRejectedValueOnce(new Error("x")).mockResolvedValue(1), { attempts: 3, delayMs: 250, sleep }).catch(() => {});
    expect(sleep.mock.calls).toEqual([[250]]);
  });
});
