"use client";

import { Play, Trash } from "@phosphor-icons/react";
import type { AutomationRule } from "@/lib/api";
import { CardAction } from "@/components/home/card-action";
import { ProgressRing } from "@/components/home/progress-ring";

// Automation cards have no poster, so this hand-rolls the MediaCard look
// (rounded-xl shadow-card bg-card, hover overlay, inset ring) on a text card.
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
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onEdit}
      onKeyDown={(e) => { if (e.key === "Enter") onEdit(); }}
      className="w-56 rounded-xl shadow-card bg-card p-4 flex flex-col text-left hover:bg-accent/50 transition-colors group cursor-pointer relative overflow-hidden"
    >
      <p className="text-sm font-medium leading-tight line-clamp-1 group-hover:text-foreground">{rule.name}</p>
      <div className="mt-2">
        <span className="text-2xs bg-automation/15 text-automation px-1.5 py-0.5 rounded-full">
          {rule.triggerType.replace(":", " ")}
        </span>
      </div>
      <p className="mt-2 text-2xs text-muted-foreground line-clamp-3 flex-1">
        {rule.prompt}
      </p>
      <p className="mt-2 text-2xs text-muted-foreground">
        Triggered {rule.triggerCount} time{rule.triggerCount !== 1 ? "s" : ""}
      </p>
      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-end p-2 gap-1.5">
        <CardAction
          icon={Play}
          label={running ? "Running…" : "Run now"}
          onClick={onRun}
        />
        <CardAction
          icon={Trash}
          label="Delete"
          destructive
          onClick={() => {
            if (confirm(`Delete "${rule.name}"?`)) onDelete();
          }}
        />
      </div>
      <ProgressRing busy={running} color="automation" />
    </div>
  );
}
