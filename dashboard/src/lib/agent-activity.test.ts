// Runs via root `npm test` (vitest's default glob sweeps the dashboard even
// though it isn't a workspace). Imports must stay relative. Nothing maps the
// "@/" alias outside Next.
import { describe, it, expect } from "vitest";
import {
  describeToolCall,
  groupActivity,
  parseEventRow,
  parseToolRow,
} from "./agent-activity";

const row = (id: number, patch: Partial<{ role: string; kind: string; content: string }>) => ({
  id,
  role: "assistant",
  content: "",
  ...patch,
});

describe("parseToolRow", () => {
  it("carries toolUseId and status from structured rows", () => {
    const call = parseToolRow(
      row(1, {
        kind: "tool",
        content: JSON.stringify({ name: "WebFetch", input: { url: "https://example.com" }, toolUseId: "tu_1", status: "failed" }),
      })
    );
    expect(call).toEqual({
      key: "1",
      name: "WebFetch",
      input: { url: "https://example.com" },
      toolUseId: "tu_1",
      status: "failed",
    });
  });

  it("leaves status undefined on rows without one or with an unknown value", () => {
    expect(parseToolRow(row(1, { kind: "tool", content: JSON.stringify({ name: "Bash" }) }))?.status).toBeUndefined();
    expect(
      parseToolRow(row(2, { kind: "tool", content: JSON.stringify({ name: "Bash", status: "running" }) }))?.status
    ).toBeUndefined();
  });

  it("still reads legacy [tool: X] text rows", () => {
    expect(parseToolRow(row(3, { content: "[tool: Bash]" }))).toEqual({ key: "3", name: "Bash" });
  });
});

describe("parseEventRow", () => {
  it("parses the documented event payload", () => {
    const event = parseEventRow(
      row(4, {
        role: "user",
        kind: "event",
        content: JSON.stringify({
          event: "automation-fired",
          ruleId: "r1",
          ruleName: "Subtitles for new episodes",
          trigger: "event",
          summary: "torrent completed",
        }),
      })
    );
    expect(event).toEqual({
      event: "automation-fired",
      ruleId: "r1",
      ruleName: "Subtitles for new episodes",
      trigger: "event",
      summary: "torrent completed",
    });
  });

  it("rejects non-event rows and malformed content", () => {
    expect(parseEventRow(row(5, { kind: "system", content: "Stopped" }))).toBeNull();
    expect(parseEventRow(row(6, { kind: "event", content: "not json" }))).toBeNull();
    expect(parseEventRow(row(7, { kind: "event", content: JSON.stringify({ summary: "x" }) }))).toBeNull();
  });
});

describe("groupActivity", () => {
  it("emits event items and folds consecutive tools", () => {
    const items = groupActivity([
      row(1, { role: "user", kind: "event", content: JSON.stringify({ event: "automation-fired", summary: "s" }) }),
      row(2, { kind: "tool", content: JSON.stringify({ name: "Bash" }) }),
      row(3, { kind: "tool", content: JSON.stringify({ name: "Read", status: "done" }) }),
      row(4, { kind: "system", content: "Stopped" }),
      row(5, { kind: "text", content: "Done." }),
    ]);
    expect(items.map((i) => i.type)).toEqual(["event", "tools", "system", "msg"]);
    const tools = items[1];
    if (tools.type !== "tools") throw new Error("expected tools");
    expect(tools.calls.map((c) => c.status)).toEqual([undefined, "done"]);
  });
});

describe("describeToolCall", () => {
  it("phrases failures per tool with a default", () => {
    expect(describeToolCall({ key: "1", name: "WebFetch", input: { url: "https://www.example.com/x" } }).failed).toBe(
      "Couldn't fetch example.com"
    );
    expect(describeToolCall({ key: "2", name: "Mystery" }).failed).toBe("Mystery failed");
  });

  it("clips oversized inputs in the tooltip detail", () => {
    const command = "x".repeat(20_000);
    const phrase = describeToolCall({ key: "3", name: "Bash", input: { command } });
    expect(phrase.detail!.length).toBeLessThanOrEqual(300);
    expect(phrase.done.length).toBeLessThan(60);
  });
});
