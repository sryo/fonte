"use client";

import { cn } from "@/lib/utils";

/** Muted-track kind picker; type="button" so modal forms don't submit on select. */
export function Segmented<K extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: K;
  onChange: (v: K) => void;
  options: { value: K; label: string }[];
  className?: string;
}) {
  return (
    <div role="group" className={cn("flex rounded-lg bg-muted p-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex-1 rounded-md px-2 py-1.5 text-xs font-bold transition-colors",
            value === o.value ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
