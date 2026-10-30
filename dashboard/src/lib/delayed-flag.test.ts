import { describe, expect, it } from "vitest";
import { nextDelayedFlagTimer } from "./delayed-flag";

const opts = { delayMs: 400, minMs: 400 };

describe("nextDelayedFlagTimer", () => {
  it("shows a state only after it has lasted the delay", () => {
    expect(nextDelayedFlagTimer({ active: true, shownAt: null, now: 1000 }, opts)).toEqual({ afterMs: 400, show: true });
  });

  it("never shows a state that ended before the delay", () => {
    expect(nextDelayedFlagTimer({ active: false, shownAt: null, now: 1000 }, opts)).toBeNull();
  });

  it("leaves a shown state alone while it lasts", () => {
    expect(nextDelayedFlagTimer({ active: true, shownAt: 900, now: 1000 }, opts)).toBeNull();
  });

  it("keeps a shown state up for the minimum time", () => {
    expect(nextDelayedFlagTimer({ active: false, shownAt: 900, now: 1000 }, opts)).toEqual({ afterMs: 300, show: false });
  });

  it("hides at once when the minimum has already passed", () => {
    expect(nextDelayedFlagTimer({ active: false, shownAt: 0, now: 1000 }, opts)).toEqual({ afterMs: 0, show: false });
  });
});
