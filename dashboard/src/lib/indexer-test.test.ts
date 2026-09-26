// Runs via root `npm test`; imports stay relative (nothing maps "@/" outside Next).
import { describe, it, expect } from "vitest";
import { describeIndexerTest, normalizeJackettUrl } from "./indexer-test";

const base = { ok: true, count: 0, configured: false };

describe("describeIndexerTest", () => {
  it("reports a working connection with its indexer count", () => {
    expect(describeIndexerTest({ ...base, count: 8, configured: true })).toEqual({
      ok: true,
      text: "Connected. 8 indexers",
    });
    expect(describeIndexerTest({ ...base, count: 1, configured: true }).text).toBe("Connected. 1 indexer");
  });

  it("does not call an unreachable Jackett connected", () => {
    expect(
      describeIndexerTest({ ...base, reason: "jackett-error", jackettUrl: "http://localhost:9117" })
    ).toEqual({ ok: false, text: "Can't reach Jackett at http://localhost:9117" });
  });

  it("asks for the URL and key when they are missing", () => {
    expect(describeIndexerTest({ ...base, reason: "jackett-not-configured" })).toEqual({
      ok: false,
      text: "Add the Jackett URL and API key first",
    });
  });

  it("flags a failed indexer query instead of the stale count", () => {
    expect(describeIndexerTest({ ...base, count: 1, configured: true, countError: "HTTP 401" })).toEqual({
      ok: false,
      text: "Jackett is up but rejected the API key (HTTP 401)",
    });
  });

  it("does not blame the API key for a slow indexer query", () => {
    expect(
      describeIndexerTest({ ...base, count: 1, configured: true, countError: "The operation was aborted due to timeout" })
    ).toEqual({
      ok: false,
      text: "Jackett is up but listing indexers failed. The operation was aborted due to timeout",
    });
  });

  it("flags a Jackett with no indexers set up", () => {
    expect(describeIndexerTest({ ...base, jackettUrl: "http://localhost:9117" })).toEqual({
      ok: false,
      text: "Connected, but no indexers are set up in Jackett",
    });
  });
});

describe("normalizeJackettUrl", () => {
  it("adds http:// when the scheme is missing", () => {
    expect(normalizeJackettUrl("localhost:9117")).toBe("http://localhost:9117");
    expect(normalizeJackettUrl("192.168.1.5:9117/")).toBe("http://192.168.1.5:9117/");
  });

  it("keeps an explicit scheme and an empty value", () => {
    expect(normalizeJackettUrl("https://jackett.example")).toBe("https://jackett.example");
    expect(normalizeJackettUrl("HTTP://localhost:9117")).toBe("HTTP://localhost:9117");
    expect(normalizeJackettUrl("")).toBe("");
  });
});
