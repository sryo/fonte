import { cn } from "@/lib/utils";

/** Missing-art placeholder: the first letter, 900 weight, ghost ink. */
export function GhostInitial({ text, className }: { text: string; className?: string }) {
  return (
    <span aria-hidden className={cn("font-black uppercase text-ghost select-none", className)}>
      {text.trim().charAt(0)}
    </span>
  );
}
