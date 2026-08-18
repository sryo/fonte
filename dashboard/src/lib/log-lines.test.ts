import { describe, it, expect } from "vitest";
import {
  isLogLevelFilter,
  logLevelTone,
  matchesLevelFilter,
  parseLogLine,
} from "./log-lines";

const WARN_LINE = "[2026-08-17T21:02:50.322Z] [WARN] Indexer count failed (Jackett is up): timeout";
const INFO_LINE = "[2026-08-17T20:54:38.944Z] [INFO] Watchlist runner started (every 30 min)";
const ERROR_LINE = "[2026-08-17T20:54:38.944Z] [ERROR] Something broke";
const DEBUG_LINE = "[2026-08-17T20:54:38.937Z] [DEBUG] No plugins directory found";

describe("parseLogLine", () => {
  it("splits a daemon line into time, level, and message", () => {
    const parsed = parseLogLine(WARN_LINE);
    expect(parsed?.level).toBe("WARN");
    expect(parsed?.message).toBe("Indexer count failed (Jackett is up): timeout");
    expect(parsed?.time).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it("keeps brackets that belong to the message", () => {
    const parsed = parseLogLine("[2026-08-17T20:54:38.944Z] [INFO] [Schedule] Starting scheduler");
    expect(parsed?.message).toBe("[Schedule] Starting scheduler");
  });

  it("keeps multi-line messages intact", () => {
    const parsed = parseLogLine("[2026-08-17T20:54:38.944Z] [ERROR] boom\n  at someFunction");
    expect(parsed?.message).toBe("boom\n  at someFunction");
  });

  it("returns null for a line in another format", () => {
    expect(parseLogLine("plain console output")).toBeNull();
    expect(parseLogLine("")).toBeNull();
  });

  it("returns null when the timestamp is not a real date", () => {
    expect(parseLogLine("[2026-13-45T99:99:99.000Z] [INFO] nope")).toBeNull();
  });
});

describe("matchesLevelFilter", () => {
  it("passes everything on all", () => {
    for (const line of [WARN_LINE, INFO_LINE, DEBUG_LINE, "unparseable"]) {
      expect(matchesLevelFilter(line, "all")).toBe(true);
    }
  });

  it("matches only the selected level", () => {
    expect(matchesLevelFilter(WARN_LINE, "warn")).toBe(true);
    expect(matchesLevelFilter(INFO_LINE, "warn")).toBe(false);
    expect(matchesLevelFilter(ERROR_LINE, "error")).toBe(true);
    expect(matchesLevelFilter(INFO_LINE, "info")).toBe(true);
  });

  it("hides debug and unparseable lines behind the level filters", () => {
    expect(matchesLevelFilter(DEBUG_LINE, "info")).toBe(false);
    expect(matchesLevelFilter("unparseable", "info")).toBe(false);
  });
});

describe("logLevelTone", () => {
  it("maps levels onto UI tones", () => {
    expect(logLevelTone("ERROR")).toBe("error");
    expect(logLevelTone("WARN")).toBe("warn");
    expect(logLevelTone("INFO")).toBe("neutral");
    expect(logLevelTone("DEBUG")).toBe("neutral");
  });
});

describe("isLogLevelFilter", () => {
  it("accepts known filters and rejects anything else", () => {
    expect(isLogLevelFilter("warn")).toBe(true);
    expect(isLogLevelFilter("all")).toBe(true);
    expect(isLogLevelFilter("verbose")).toBe(false);
    expect(isLogLevelFilter(3)).toBe(false);
  });
});
