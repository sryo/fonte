// Runs via root `npm test`; imports stay relative (nothing maps "@/" outside Next).
import { describe, it, expect } from "vitest";
import { buildSentHistory, isBrowsingHistory, stepHistory } from "./input-history";

const user = (content: string, kind?: string) => ({ role: "user", kind, content });

describe("buildSentHistory", () => {
  it("keeps typed messages, oldest first, and collapses consecutive repeats", () => {
    expect(
      buildSentHistory([
        user("the history of concrete", "text"),
        { role: "assistant", kind: "text", content: "Concrete has a long history" },
        user("the history of concrete", "text"),
        user('{"event":"automation-fired"}', "event"),
        user("  last seen  "),
        user("last seen", "text"),
        user("the history of concrete", "text"),
      ])
    ).toEqual(["the history of concrete", "last seen", "the history of concrete"]);
  });
});

describe("stepHistory", () => {
  const entries = ["first", "second", "third"];

  it("recalls the newest entry from an empty field, then walks older and stops at the oldest", () => {
    expect(stepHistory(entries, null, "", "ArrowUp")).toEqual({ index: 2, value: "third" });
    expect(stepHistory(entries, 2, "third", "ArrowUp")).toEqual({ index: 1, value: "second" });
    expect(stepHistory(entries, 0, "first", "ArrowUp")).toEqual({ index: 0, value: "first" });
  });

  it("walks newer with Down and clears past the newest", () => {
    expect(stepHistory(entries, 1, "second", "ArrowDown")).toEqual({ index: 2, value: "third" });
    expect(stepHistory(entries, 2, "third", "ArrowDown")).toEqual({ index: null, value: "" });
  });

  it("leaves the keys alone once the person has typed or edited", () => {
    expect(stepHistory(entries, null, "a draft", "ArrowUp")).toBeNull();
    expect(stepHistory(entries, 2, "third, edited", "ArrowUp")).toBeNull();
    expect(stepHistory(entries, 2, "third, edited", "ArrowDown")).toBeNull();
    expect(stepHistory(entries, null, "", "ArrowDown")).toBeNull();
    expect(stepHistory(entries, null, "", "Escape")).toBeNull();
  });

  it("restarts from the newest after the field was cleared mid-browse", () => {
    expect(stepHistory(entries, 0, "", "ArrowUp")).toEqual({ index: 2, value: "third" });
  });

  it("clears on Escape only while browsing", () => {
    expect(stepHistory(entries, 1, "second", "Escape")).toEqual({ index: null, value: "" });
    expect(isBrowsingHistory(entries, 1, "second")).toBe(true);
    expect(isBrowsingHistory(entries, 1, "second!")).toBe(false);
  });

  it("does nothing with no history", () => {
    expect(stepHistory([], null, "", "ArrowUp")).toBeNull();
  });
});
