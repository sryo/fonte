import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { GhostCount } from "@/components/ui/ghost-count";

/** Card-vocabulary container for detail-page and settings sections. */
export function Section({
  title,
  count,
  description,
  action,
  children,
  className,
}: {
  title: ReactNode;
  count?: number;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl shadow-card bg-card p-4", className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-2xl font-black tracking-tight">
            {title}
            {count !== undefined && <GhostCount count={count} />}
          </h2>
          {description && (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
