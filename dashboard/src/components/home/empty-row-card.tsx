"use client";

import React from "react";
import { cn } from "@/lib/utils";

export function EmptyRowCard({
  icon: Icon,
  label,
  hint,
  hintClassName,
  active,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  hint?: string;
  hintClassName?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const interactive = Boolean(onClick);
  return (
    <div
      onClick={onClick}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={interactive ? (e) => { if (e.key === "Enter") onClick?.(); } : undefined}
      className={cn(
        "w-44 rounded-xl border border-dashed bg-card/30 overflow-hidden text-left transition-colors",
        interactive &&
          "hover:bg-accent/50 hover:border-foreground/30 cursor-pointer focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        active && "bg-accent/50 border-foreground/30"
      )}
    >
      <div className="aspect-[2/3] w-full flex items-center justify-center bg-gradient-to-br from-muted/30 to-transparent">
        <Icon className="h-12 w-12 text-muted-foreground/40" weight="thin" />
      </div>
      <div className="p-3 space-y-1">
        <p className="text-sm font-medium leading-tight text-muted-foreground">{label}</p>
        {hint && (
          <p className={cn("text-2xs text-muted-foreground/70 leading-tight", hintClassName)}>{hint}</p>
        )}
      </div>
    </div>
  );
}
