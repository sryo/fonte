import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-2xs font-medium text-muted-foreground shrink-0",
        className
      )}
    >
      {children}
    </kbd>
  );
}
