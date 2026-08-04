import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Cross-dissolves between icons stacked in one grid cell. The deep
    scale-down plus blur reads as a dissolve rather than two ghosts
    passing through each other. */
export function IconSwap({
  active,
  icons,
  className,
}: {
  /** Key into `icons` of the one currently shown. */
  active: string;
  icons: Record<string, ReactNode>;
  className?: string;
}) {
  return (
    <span className={cn("inline-grid place-items-center", className)}>
      {Object.entries(icons).map(([key, icon]) => (
        <span
          key={key}
          aria-hidden={key !== active}
          className={cn(
            "col-start-1 row-start-1 inline-flex transition-[opacity,scale,filter] duration-250 ease-in-out motion-reduce:transition-none",
            key === active ? "opacity-100 scale-100 blur-none" : "opacity-0 scale-25 blur-[2px]"
          )}
        >
          {icon}
        </span>
      ))}
    </span>
  );
}
