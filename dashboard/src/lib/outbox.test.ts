import { describe, expect, it } from "vitest";
import { afterSendError, isUnreachable, takeWaiting, type Outbound } from "./outbox";

const outbound = (messageId: string, extra: Partial<Outbound> = {}): Outbound => ({
  messageId,
  content: messageId,
  createdAt: 1,
  phase: "pending",
  ...extra,
});

describe("isUnreachable", () => {
  it("is true when fetch never reached the daemon", () => {
    expect(isUnreachable(new TypeError("Failed to fetch"))).toBe(true);
    expect(isUnreachable(new TypeError("Load failed"))).toBe(true);
  });

  it("is false when the daemon answered with an error", () => {
    expect(isUnreachable(new Error("message is required"))).toBe(false);
    expect(isUnreachable("nope")).toBe(false);
  });
});

describe("afterSendError", () => {
  it("keeps an unreachable send pending until the daemon is back", () => {
    expect(afterSendError(new TypeError("Failed to fetch"))).toEqual({ phase: "pending", waiting: true, error: undefined });
  });

  it("fails a send the daemon rejected", () => {
    expect(afterSendError(new Error("message is required"))).toEqual({ phase: "failed", waiting: false, error: "message is required" });
  });
});

describe("takeWaiting", () => {
  it("hands back waiting sends in the order they were made and clears their flag", () => {
    const outbox = [
      outbound("a", { waiting: true }),
      outbound("b", { phase: "failed", error: "rejected" }),
      outbound("c", { waiting: true }),
    ];
    const { waiting, outbox: next } = takeWaiting(outbox);
    expect(waiting.map((o) => o.messageId)).toEqual(["a", "c"]);
    expect(waiting.every((o) => !o.waiting)).toBe(true);
    expect(next.map((o) => [o.messageId, Boolean(o.waiting)])).toEqual([["a", false], ["b", false], ["c", false]]);
    expect(next[1]).toBe(outbox[1]);
  });

  it("returns the same outbox when nothing waits", () => {
    const outbox = [outbound("a")];
    expect(takeWaiting(outbox)).toEqual({ waiting: [], outbox });
    expect(takeWaiting(outbox).outbox).toBe(outbox);
  });
});
