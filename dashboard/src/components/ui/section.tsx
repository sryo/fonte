import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Card-vocabulary container for detail-page sections. */
export function Section({
  title,
  count,
  action,
  children,
  className,
}: {
  title: string;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl shadow-card bg-card p-4", className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          {title}
          {count !== undefined && (
            <span className="ml-1.5 font-normal text-muted-foreground">({count})</span>
          )}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}
