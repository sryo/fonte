import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

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
          <h2 className="text-sm font-semibold">
            {title}
            {count !== undefined && (
              <span className="ml-1.5 font-normal text-muted-foreground">({count})</span>
            )}
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
