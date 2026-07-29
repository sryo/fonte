"use client";

import { useState } from "react";
import { Play, Trash } from "@phosphor-icons/react";
import type { AutomationRule } from "@/lib/api";
import { CardAction } from "@/components/home/card-action";
import { ProgressRing } from "@/components/home/progress-ring";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

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
      className="w-56 rounded-xl shadow-card bg-card p-4 flex flex-col text-left hover:bg-accent/50 transition-colors group cursor-pointer relative overflow-hidden focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <p className="text-sm font-medium leading-tight line-clamp-1 group-hover:text-foreground" title={rule.name}>{rule.name}</p>
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
            hotkey="⌫"
          />
        </div>
      </div>
      <ProgressRing busy={running} color="automation" />
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
