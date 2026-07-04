"use client";

import { type ReactNode } from "react";
import Link from "next/link";
import { CaretLeft } from "@phosphor-icons/react";

export function PageHeader({
  backHref,
  title,
  actions,
}: {
  backHref?: string;
  title?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-center gap-2">
      {backHref && (
        <Link
          href={backHref}
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <CaretLeft className="size-4" />
        </Link>
      )}
      {title && <div className="min-w-0 flex-1 truncate text-sm font-medium">{title}</div>}
      {!title && <div className="flex-1" />}
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
