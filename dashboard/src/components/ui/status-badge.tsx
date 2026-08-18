"use client";

import { cn } from "@/lib/utils";
import { statusTone, TONE_TEXT } from "@/lib/status";

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
        "font-extrabold capitalize",
        size === "xs" ? "text-2xs" : "text-xs",
        TONE_TEXT[statusTone(status)],
        className
      )}
    >
      {label ?? status}
    </span>
  );
}
