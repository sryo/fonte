// Runs via root `npm test`; imports stay relative (nothing maps "@/" outside Next).
import { describe, it, expect } from "vitest";
import { parseNumberDraft } from "./number-draft";

describe("parseNumberDraft", () => {
  it("rejects blank and non-numeric drafts", () => {
    expect(parseNumberDraft("", { integer: true })).toBeNull();
    expect(parseNumberDraft("   ", { integer: true })).toBeNull();
    expect(parseNumberDraft("abc", { integer: false })).toBeNull();
  });

  it("reads exponent notation the number input accepts", () => {
    expect(parseNumberDraft("1e3", { integer: true })).toBe(1000);
  });

  it("rounds integer fields instead of truncating", () => {
    expect(parseNumberDraft("2.7", { integer: true })).toBe(3);
  });

  it("keeps decimals for fractional fields", () => {
    expect(parseNumberDraft("1.25", { integer: false })).toBe(1.25);
  });

  it("clamps to the minimum", () => {
    expect(parseNumberDraft("-5", { integer: true, min: 0 })).toBe(0);
    expect(parseNumberDraft("0", { integer: true, min: 1 })).toBe(1);
  });
});
