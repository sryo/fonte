// Turns raw agent history rows into human phrases and render items: verb +
// one salient argument, progressive tense while the run is live, past tense
// once settled.

export interface ToolCall {
  key: string;
  name: string;
  input?: Record<string, unknown>;
}

interface ActivityRow {
  id: number | string;
  content: string;
  role: string;
  kind?: string;
}

const LEGACY_TOOL_RE = /^\[tool: (.+)\]$/;

/** Structured tool row, or the legacy `[tool: X]` text rows from old runs. */
export function parseToolRow(msg: ActivityRow): ToolCall | null {
  const key = String(msg.id);
  if (msg.kind === "tool") {
    try {
      const parsed = JSON.parse(msg.content) as { name?: string; input?: Record<string, unknown> };
      if (parsed.name) return { key, name: parsed.name, input: parsed.input };
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

export type ActivityItem<T extends ActivityRow> =
  | { type: "msg"; row: T }
  | { type: "system"; row: T }
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
    items.push({ type: row.kind === "system" ? "system" : "msg", row });
  }
  return items;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

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

function clip(s: string | undefined, max = 40): string | undefined {
  if (!s) return undefined;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

interface Phrase {
  live: string;
  done: string;
  detail?: string;
}

/** verb + object per tool; unknown tools fall back to "Using {name}". */
export function describeToolCall(call: ToolCall): Phrase {
  const input = call.input ?? {};
  switch (call.name) {
    case "WebFetch": {
      const site = domainOf(str(input.url)) ?? "a page";
      return { live: `Fetching ${site}`, done: `Fetched ${site}`, detail: str(input.url) };
    }
    case "WebSearch": {
      const q = clip(str(input.query));
      return q
        ? { live: `Searching for “${q}”`, done: `Searched for “${q}”` }
        : { live: "Searching the web", done: "Searched the web" };
    }
    case "ToolSearch":
      return { live: "Loading tools", done: "Loaded tools" };
    case "Bash": {
      const cmd = clip(str(input.command), 36);
      return cmd
        ? { live: `Running ${cmd}`, done: `Ran ${cmd}`, detail: str(input.command) }
        : { live: "Running a command", done: "Ran a command" };
    }
    case "Read": {
      const f = tail(str(input.file_path));
      return { live: `Reading ${f ?? "a file"}`, done: `Read ${f ?? "a file"}` };
    }
    case "Write":
    case "Edit": {
      const f = tail(str(input.file_path));
      return { live: `Editing ${f ?? "a file"}`, done: `Edited ${f ?? "a file"}` };
    }
    case "Grep":
    case "Glob": {
      const p = clip(str(input.pattern), 28);
      return p
        ? { live: `Searching files for ${p}`, done: `Searched files for ${p}` }
        : { live: "Searching files", done: "Searched files" };
    }
    case "Task":
    case "Agent":
      return { live: "Delegating to a subagent", done: "Delegated to a subagent" };
    default:
      return { live: `Using ${call.name}`, done: `Used ${call.name}` };
  }
}
