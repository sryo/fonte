import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { TONE_DOT, type Tone } from "@/lib/status";

/** The one badge style that stays readable over poster art. */
export function PosterBadge({ tone, children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className="text-xs font-bold bg-black/60 text-white px-2 py-0.5 rounded-full flex items-center gap-1">
      {tone && <span aria-hidden className={cn("size-1.5 rounded-full shrink-0", TONE_DOT[tone])} />}
      {children}
    </span>
  );
}
