import type { Tone } from "./status";

export type ParsedLogLine = { time: string; level: string; message: string };
export type LogLevelFilter = "all" | "info" | "warn" | "error";

export const LOG_LEVEL_FILTERS: { key: LogLevelFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "info", label: "Info" },
  { key: "warn", label: "Warn" },
  { key: "error", label: "Error" },
];

export function isLogLevelFilter(value: unknown): value is LogLevelFilter {
  return typeof value === "string" && LOG_LEVEL_FILTERS.some((f) => f.key === value);
}

const LINE_RE = /^\[(\d{4}-\d{2}-\d{2}T[^\]]+)\] \[([A-Z]+)\] ([\s\S]*)$/;

export function parseLogLine(line: string): ParsedLogLine | null {
  const match = LINE_RE.exec(line);
  if (!match) return null;
  const date = new Date(match[1]);
  if (Number.isNaN(date.getTime())) return null;
  return {
    time: date.toLocaleTimeString(undefined, { hour12: false }),
    level: match[2],
    message: match[3],
  };
}

/** Unparsed lines and DEBUG only survive the "all" filter. */
export function matchesLevelFilter(line: string, filter: LogLevelFilter): boolean {
  if (filter === "all") return true;
  const parsed = parseLogLine(line);
  return parsed?.level === filter.toUpperCase();
}

export function logLevelTone(level: string): Tone {
  if (level === "ERROR") return "error";
  if (level === "WARN") return "warn";
  return "neutral";
}
