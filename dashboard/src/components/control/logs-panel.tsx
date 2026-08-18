"use client";

import { useEffect, useRef } from "react";
import { ArrowsClockwise, Scroll } from "@phosphor-icons/react";
import { getLogs } from "@/lib/api";
import { usePolling } from "@/lib/hooks";
import { usePersistedState } from "@/hooks/use-persisted-state";
import {
  LOG_LEVEL_FILTERS,
  isLogLevelFilter,
  logLevelTone,
  matchesLevelFilter,
  parseLogLine,
  type LogLevelFilter,
} from "@/lib/log-lines";
import { TONE_TEXT } from "@/lib/status";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/feedback";
import { Section } from "@/components/ui/section";

export function LogsPanel() {
  const { data: logs, refresh } = usePolling<{ lines: string[] }>(() => getLogs(200), 5000);
  const [level, setLevel] = usePersistedState<LogLevelFilter>(
    "fonte.log-level",
    "all",
    isLogLevelFilter,
  );

  const lines = logs?.lines ?? [];
  const filtered = lines.filter((line) => matchesLevelFilter(line, level));

  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (el) pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [filtered.length, level]);

  return (
    <Section
      title={
        <>
          <Scroll className="h-3.5 w-3.5" />
          Logs
        </>
      }
      count={filtered.length}
      action={
        <div className="flex items-center gap-1">
          {LOG_LEVEL_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setLevel(f.key)}
              aria-pressed={level === f.key}
              className={cn(
                "rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
                level === f.key
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground hover:bg-muted/80",
              )}
            >
              {f.label}
            </button>
          ))}
          <button
            onClick={() => refresh()}
            title="Refresh"
            className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowsClockwise className="h-3.5 w-3.5" />
          </button>
        </div>
      }
    >
      <div ref={scrollRef} onScroll={handleScroll} className="max-h-[40vh] overflow-y-auto">
        {filtered.length > 0 ? (
          <div className="font-mono text-xs leading-relaxed">
            {filtered.map((line, i) => {
              const parsed = parseLogLine(line);
              if (!parsed) {
                return (
                  <div key={i} className="py-0.5 break-words text-muted-foreground">
                    {line}
                  </div>
                );
              }
              return (
                <div key={i} className="flex gap-2 py-0.5">
                  <span className="shrink-0 tabular-nums text-muted-foreground">{parsed.time}</span>
                  <span className={cn("w-12 shrink-0", TONE_TEXT[logLevelTone(parsed.level)])}>
                    {parsed.level}
                  </span>
                  <span className="min-w-0 break-words whitespace-pre-wrap text-muted-foreground">
                    {parsed.message}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={Scroll}
            title={lines.length > 0 ? "No matching lines" : "No logs yet"}
            hint={lines.length > 0 ? "Try a different level." : undefined}
          />
        )}
      </div>
    </Section>
  );
}
