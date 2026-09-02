// Turns raw agent history rows into human phrases and render items: verb +
// one salient argument, progressive tense while the run is live, past tense
// once settled, a failure phrasing when the backend marked the call failed.

export type ToolStatus = "done" | "failed";

export interface ToolCall {
  key: string;
  name: string;
  input?: Record<string, unknown>;
  toolUseId?: string;
  /** Absent on rows written before the backend tracked outcomes. */
  status?: ToolStatus;
}

export type TranscriptEventName = "automation-fired" | "automation-paused";

/** Parsed `kind: 'event'` row. Unknown event names still carry a summary. */
export interface TranscriptEvent {
  event: TranscriptEventName | string;
  ruleId?: string;
  ruleName?: string;
  trigger?: "event" | "schedule" | "manual";
  summary: string;
}

interface ActivityRow {
  id: number | string;
  content: string;
  role: string;
  kind?: string;
}

const LEGACY_TOOL_RE = /^\[tool: (.+)\]$/;

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** Structured tool row, or the legacy `[tool: X]` text rows from old runs. */
export function parseToolRow(msg: ActivityRow): ToolCall | null {
  const key = String(msg.id);
  if (msg.kind === "tool") {
    try {
      const parsed = JSON.parse(msg.content) as {
        name?: string;
        input?: Record<string, unknown>;
        toolUseId?: string;
        status?: string;
      };
      if (parsed.name) {
        const status = parsed.status === "done" || parsed.status === "failed" ? parsed.status : undefined;
        return { key, name: parsed.name, input: parsed.input, toolUseId: str(parsed.toolUseId), status };
      }
    } catch {
      return { key, name: msg.content, input: undefined };
    }
  }
  if (
    msg.role === "assistant" &&
    (msg.kind === undefined || msg.kind === "text") &&
    msg.content.startsWith("[tool:")
  ) {
    const legacy = LEGACY_TOOL_RE.exec(msg.content.trim());
    if (legacy) return { key, name: legacy[1] };
  }
  return null;
}

/** `kind: 'event'` content, or null when it isn't the documented JSON shape. */
export function parseEventRow(msg: ActivityRow): TranscriptEvent | null {
  if (msg.kind !== "event") return null;
  try {
    const parsed = JSON.parse(msg.content) as Partial<TranscriptEvent>;
    if (typeof parsed !== "object" || parsed === null || !str(parsed.event)) return null;
    const trigger = parsed.trigger;
    return {
      event: parsed.event as string,
      ruleId: str(parsed.ruleId),
      ruleName: str(parsed.ruleName),
      trigger: trigger === "event" || trigger === "schedule" || trigger === "manual" ? trigger : undefined,
      summary: str(parsed.summary) ?? "",
    };
  } catch {
    return null;
  }
}

export type ActivityItem<T extends ActivityRow> =
  | { type: "msg"; row: T }
  | { type: "system"; row: T }
  | { type: "event"; row: T }
  | { type: "tools"; key: string; calls: ToolCall[] };

/** Consecutive tool rows collapse into one activity group. */
export function groupActivity<T extends ActivityRow>(rows: T[]): ActivityItem<T>[] {
  const items: ActivityItem<T>[] = [];
  for (const row of rows) {
    const tool = parseToolRow(row);
    if (tool) {
      const last = items[items.length - 1];
      if (last?.type === "tools") last.calls.push(tool);
      else items.push({ type: "tools", key: `tools-${row.id}`, calls: [tool] });
      continue;
    }
    if (row.kind === "system") items.push({ type: "system", row });
    else if (row.kind === "event") items.push({ type: "event", row });
    else items.push({ type: "msg", row });
  }
  return items;
}

function domainOf(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function tail(path?: string): string | undefined {
  if (!path) return undefined;
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1];
}

export function clip(s: string | undefined, max = 40): string | undefined {
  if (!s) return undefined;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Tool inputs can run to ~20k chars; a tooltip only needs the head of it. */
const DETAIL_MAX = 300;

interface Phrase {
  live: string;
  done: string;
  failed: string;
  detail?: string;
}

/** verb + object per tool; unknown tools fall back to "Using {name}". */
export function describeToolCall(call: ToolCall): Phrase {
  const input = call.input ?? {};
  switch (call.name) {
    case "WebFetch": {
      const site = domainOf(str(input.url)) ?? "a page";
      return {
        live: `Fetching ${site}`,
        done: `Fetched ${site}`,
        failed: `Couldn't fetch ${site}`,
        detail: clip(str(input.url), DETAIL_MAX),
      };
    }
    case "WebSearch": {
      const q = clip(str(input.query));
      return q
        ? { live: `Searching for “${q}”`, done: `Searched for “${q}”`, failed: `Couldn't search for “${q}”` }
        : { live: "Searching the web", done: "Searched the web", failed: "Couldn't search the web" };
    }
    case "ToolSearch":
      return { live: "Loading tools", done: "Loaded tools", failed: "Couldn't load tools" };
    case "Bash": {
      const cmd = clip(str(input.command), 36);
      return cmd
        ? {
            live: `Running ${cmd}`,
            done: `Ran ${cmd}`,
            failed: `Couldn't run ${cmd}`,
            detail: clip(str(input.command), DETAIL_MAX),
          }
        : { live: "Running a command", done: "Ran a command", failed: "Couldn't run a command" };
    }
    case "Read": {
      const f = tail(str(input.file_path)) ?? "a file";
      return { live: `Reading ${f}`, done: `Read ${f}`, failed: `Couldn't read ${f}` };
    }
    case "Write":
    case "Edit": {
      const f = tail(str(input.file_path)) ?? "a file";
      return { live: `Editing ${f}`, done: `Edited ${f}`, failed: `Couldn't edit ${f}` };
    }
    case "Grep":
    case "Glob": {
      const p = clip(str(input.pattern), 28);
      return p
        ? { live: `Searching files for ${p}`, done: `Searched files for ${p}`, failed: `Couldn't search files for ${p}` }
        : { live: "Searching files", done: "Searched files", failed: "Couldn't search files" };
    }
    case "Task":
    case "Agent":
      return { live: "Delegating to a subagent", done: "Delegated to a subagent", failed: "Subagent failed" };
    default:
      return { live: `Using ${call.name}`, done: `Used ${call.name}`, failed: `${call.name} failed` };
  }
}
