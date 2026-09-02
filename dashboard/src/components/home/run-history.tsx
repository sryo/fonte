"use client";

import { useEffect, useState } from "react";
import type { AutomationRun } from "@/lib/api";
import { formatRunTime } from "@/lib/format";
import { Spinner } from "@/components/ui/feedback";
import { Check, Pause, SkipForward, XCircle } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

const TRIGGER_LABEL: Record<AutomationRun["trigger"], string> = {
  event: "event",
  schedule: "schedule",
  manual: "run now",
};

function RunGlyph({ status }: { status: AutomationRun["status"] }) {
  switch (status) {
    case "running": return <Spinner size="xs" className="text-automation" />;
    case "ok": return <Check className="h-3.5 w-3.5 text-emerald-500" weight="bold" />;
    case "error": return <XCircle className="h-3.5 w-3.5 text-destructive" weight="fill" />;
    case "interrupted": return <Pause className="h-3.5 w-3.5 text-muted-foreground" weight="fill" />;
    case "skipped": return <SkipForward className="h-3.5 w-3.5 text-muted-foreground" weight="fill" />;
  }
}

const STATUS_LABEL: Record<AutomationRun["status"], string> = {
  running: "Running",
  ok: "Succeeded",
  error: "Failed",
  interrupted: "Interrupted",
  skipped: "Skipped",
};

/** Re-renders each minute so the relative times age. */
export function RunHistory({ runs }: { runs: AutomationRun[] }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  if (runs.length === 0) {
    return <p className="mt-1.5 text-xs text-muted-foreground italic">No runs yet.</p>;
  }
  return (
    <ul className="mt-1.5 divide-y max-h-56 overflow-y-auto">
      {runs.map((run) => (
        <li key={run.id} className="flex items-start gap-2 py-1.5 text-2xs">
          <span className="mt-0.5 shrink-0" role="img" aria-label={STATUS_LABEL[run.status]}>
            <RunGlyph status={run.status} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className={cn("font-medium", run.status === "error" && "text-destructive")}>
                {STATUS_LABEL[run.status]}
                <span className="font-normal text-muted-foreground"> · {TRIGGER_LABEL[run.trigger]}</span>
              </span>
              <span className="text-muted-foreground tabular-nums shrink-0">{formatRunTime(run.startedAt, now)}</span>
            </div>
            {(run.detail || run.eventSummary) && (
              <p className="text-muted-foreground line-clamp-2">{run.detail ?? run.eventSummary}</p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
