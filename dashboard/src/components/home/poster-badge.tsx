import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { TONE_DOT, type Tone } from "@/lib/status";

/**
 * The one badge style that stays readable over poster art: a dark scrim pill
 * with white text and, optionally, a solid tone dot instead of tinted text.
 */
export function PosterBadge({ tone, children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className="text-2xs bg-black/60 text-white px-1.5 py-0.5 rounded-full flex items-center gap-1">
      {tone && <span aria-hidden className={cn("size-1.5 rounded-full shrink-0", TONE_DOT[tone])} />}
      {children}
    </span>
  );
}
