import { cn } from "@/lib/utils";

/** A count set at its heading's own size in ghost ink. */
export function GhostCount({ count, className }: { count: number; className?: string }) {
  return <span className={cn("font-black tabular-nums text-ghost", className)}>{count}</span>;
}
