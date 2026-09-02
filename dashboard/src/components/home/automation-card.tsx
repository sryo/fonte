"use client";

import { useState } from "react";
import { Play, Trash } from "@phosphor-icons/react";
import type { AutomationRule } from "@/lib/api";
import { CardAction } from "@/components/home/card-action";
import { CardResizeHandle } from "@/components/home/card-resize";
import { MiddleTruncate } from "@/components/ui/middle-truncate";
import { ProgressRing } from "@/components/home/progress-ring";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatRunTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const RUN_VERB: Record<NonNullable<AutomationRule["lastRun"]>["status"], string> = {
  running: "Running since",
  ok: "Last run succeeded",
  error: "Last run failed",
  interrupted: "Last run interrupted",
  skipped: "Last fire skipped",
};

export function describeLastRun(rule: AutomationRule): string {
  const run = rule.lastRun;
  if (!run) return "Never run";
  return `${RUN_VERB[run.status]} ${formatRunTime(run.startedAt).replace(/^([A-Z])/, (m) => m.toLowerCase())}`;
}

// Automation cards have no poster, so this hand-rolls the MediaCard look on a text card.
export function AutomationCard({
  rule,
  running,
  onRun,
  onEdit,
  onDelete,
}: {
  rule: AutomationRule;
  running: boolean;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  return (
    <>
    <div
      role="button"
      tabIndex={0}
      onClick={onEdit}
      onKeyDown={(e) => {
        if (e.key === "Enter") onEdit();
        else if ((e.key === "Delete" || e.key === "Backspace") && e.target === e.currentTarget) {
          e.preventDefault();
          setConfirmOpen(true);
        }
      }}
      className="w-[calc(var(--card-w)*1.27)] rounded-xl shadow-card bg-card p-4 flex flex-col text-left hover:bg-accent/50 transition-colors group cursor-pointer relative overflow-hidden focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <MiddleTruncate text={rule.name} className="text-sm font-medium leading-tight group-hover:text-foreground" />
      <div className="mt-2">
        <span className="text-2xs bg-automation/15 text-automation px-1.5 py-0.5 rounded-full">
          {rule.triggerDescription}
        </span>
      </div>
      <p className="mt-2 text-2xs text-muted-foreground line-clamp-3 flex-1">
        {rule.prompt}
      </p>
      <p className={cn("mt-2 text-2xs", rule.lastRun?.status === "error" ? "text-destructive" : "text-muted-foreground")}>
        {describeLastRun(rule)}
      </p>
      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
        <div className="absolute inset-0 flex items-center justify-center">
          <CardAction
            variant="primary"
            icon={Play}
            label={running ? "Running…" : "Run now"}
            onClick={onRun}
          />
        </div>
        <div className="absolute bottom-2 right-2">
          <CardAction
            icon={Trash}
            label="Delete"
            destructive
            onClick={() => setConfirmOpen(true)}
           
          />
        </div>
      </div>
      <ProgressRing busy={running} color="automation" />
      <CardResizeHandle />
    </div>
    <ConfirmDialog
      open={confirmOpen}
      title="Delete automation"
      message={<>Delete “{rule.name}”?</>}
      confirmLabel="Delete"
      destructive
      onConfirm={onDelete}
      onClose={() => setConfirmOpen(false)}
    />
    </>
  );
}
