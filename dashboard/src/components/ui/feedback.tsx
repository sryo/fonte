"use client";

import { type ReactNode } from "react";
import { type Icon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

export function Spinner({ size = "sm", className }: { size?: "xs" | "sm"; className?: string }) {
  return (
    <div
      className={cn(
        "animate-spin rounded-full border-2 border-current border-t-transparent",
        size === "xs" ? "size-3.5" : "size-5",
        className
      )}
    />
  );
}

export function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
      <Spinner />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function EmptyState({
  icon: IconComponent,
  title,
  hint,
  action,
}: {
  icon?: Icon;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      {IconComponent && <IconComponent className="size-8 text-muted-foreground/40" />}
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {action}
    </div>
  );
}
