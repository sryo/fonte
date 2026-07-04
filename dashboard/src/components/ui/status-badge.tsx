"use client";

import { cn } from "@/lib/utils";
import { statusTone, TONE_BADGE } from "@/lib/status";

export function StatusBadge({
  status,
  label,
  size = "xs",
  className,
}: {
  status: string;
  label?: string;
  size?: "xs" | "sm";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "font-medium rounded-md capitalize",
        size === "xs" ? "text-2xs px-1.5 py-0.5" : "text-xs px-2 py-0.5",
        TONE_BADGE[statusTone(status)],
        className
      )}
    >
      {label ?? status}
    </span>
  );
}
