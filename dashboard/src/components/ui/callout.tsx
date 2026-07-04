"use client";

import { type ReactNode } from "react";
import { X } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { type Tone } from "@/lib/status";

const TONE_CALLOUT: Record<Tone, string> = {
  active: "bg-torrent/10 text-torrent",
  watch: "bg-watchlist/10 text-watchlist",
  done: "bg-done/10 text-done",
  warn: "bg-warning/10 text-warning",
  error: "bg-destructive/10 text-destructive",
  neutral: "bg-muted text-muted-foreground",
};

export function Callout({
  tone,
  children,
  action,
  onDismiss,
  className,
}: {
  tone: Tone;
  children: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}) {
  return (
    <div
      role={tone === "error" || tone === "warn" ? "alert" : "status"}
      className={cn(
        "flex items-center gap-3 rounded-xl px-4 py-3 text-sm",
        TONE_CALLOUT[tone],
        className
      )}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {action}
      {onDismiss && (
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 rounded-md p-1 opacity-60 transition-opacity hover:opacity-100"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}
