"use client";

import { type ChangeEventHandler } from "react";
import { cn } from "@/lib/utils";

/** Native checkbox with tri-state support — `indeterminate` is only reachable
    through the DOM property, so it's set via ref. */
export function Checkbox({
  checked,
  indeterminate = false,
  onChange,
  title,
  className,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: ChangeEventHandler<HTMLInputElement>;
  title?: string;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={onChange}
      title={title}
      aria-label={ariaLabel}
      aria-checked={indeterminate ? "mixed" : checked}
      ref={(el) => {
        if (el) el.indeterminate = indeterminate;
      }}
      className={cn("h-4 w-4 shrink-0 cursor-pointer accent-primary", className)}
    />
  );
}
