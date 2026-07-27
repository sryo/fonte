// Progress & status UI conventions: ./README.md
import { cn, type DomainColor } from "@/lib/utils";

export type ProgressColor = DomainColor | "primary";

// Hierarchy comes from size + depth, not color.
export type ProgressVariant = "ambient" | "list" | "hero";

const FILL: Record<ProgressColor, string> = {
  torrent: "bg-torrent",
  watchlist: "bg-watchlist",
  automation: "bg-automation",
  primary: "bg-primary",
};

const TRACK: Record<ProgressVariant, string> = {
  ambient: "h-[3px] rounded-none",
  list: "h-1.5 rounded-full shadow-[inset_0_1px_0_rgb(0_0_0/0.06)] dark:shadow-[inset_0_1px_0_rgb(0_0_0/0.25)]",
  hero: "h-3.5 rounded-full shadow-[inset_0_1px_3px_rgb(0_0_0/0.12)] dark:shadow-[inset_0_1px_3px_rgb(0_0_0/0.35)]",
};

const FILL_SHEEN: Record<ProgressVariant, string> = {
  ambient: "",
  list: "",
  hero: "shadow-[inset_0_2px_2px_-1px_rgb(255_255_255/0.35)]",
};

// Clamp a 0–1 fraction to a whole-percent 0–100. Shared so the bar width and
// any adjacent "42%" label always agree.
export function toPct(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 100);
}

export function ProgressBar({
  value,
  color = "torrent",
  variant = "list",
  className,
  label,
  shine = false,
  stalled = false,
  done = false,
}: {
  value: number; // 0–1
  color?: ProgressColor;
  variant?: ProgressVariant;
  className?: string; // layout only, e.g. "w-full" or "flex-1"
  label?: string; // accessible name announced to screen readers
  shine?: boolean; // active transfer
  stalled?: boolean; // nothing is moving
  done?: boolean; // finished — turns green, overrides color
}) {
  const pct = toPct(value);
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn("overflow-hidden bg-muted", TRACK[variant], className)}
    >
      <div
        className={cn(
          "h-full rounded-full transition-all duration-300",
          done ? "bg-done" : FILL[color],
          FILL_SHEEN[variant],
          stalled && "opacity-50",
          shine && !stalled && !done && "progress-bar-fill",
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
