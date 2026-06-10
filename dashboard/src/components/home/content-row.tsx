"use client";

import React from "react";

export function ContentRow({
  title,
  count,
  icon: Icon,
  children,
  emptyContent,
  isEmpty,
  action,
}: {
  title: string;
  count: number;
  icon: React.ElementType;
  children: React.ReactNode;
  emptyContent: React.ReactNode;
  isEmpty: boolean;
  action?: React.ReactNode;
}) {
  return (
    <section className="space-y-3 animate-card-enter">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Icon className="h-5 w-5 text-muted-foreground" weight="bold" />
          {title}
          {count > 0 && (
            <span className="text-sm font-normal text-muted-foreground">({count})</span>
          )}
        </h2>
        {action}
      </div>
      {isEmpty ? (
        <div className="flex flex-wrap gap-3">{emptyContent}</div>
      ) : (
        <div className="flex flex-wrap gap-3">{children}</div>
      )}
    </section>
  );
}
