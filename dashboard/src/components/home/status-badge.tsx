"use client";

import { cn } from "@/lib/utils";

export function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    downloading: "bg-torrent/15 text-torrent",
    checking: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    seeding: "bg-green-500/15 text-green-600 dark:text-green-400",
    completed: "bg-green-500/15 text-green-600 dark:text-green-400",
    paused: "bg-muted text-muted-foreground",
    error: "bg-destructive/15 text-destructive",
    watching: "bg-watchlist/15 text-watchlist",
    fulfilled: "bg-green-500/15 text-green-600 dark:text-green-400",
  };

  return (
    <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded-md capitalize", styles[status] ?? "bg-muted text-muted-foreground")}>
      {status}
    </span>
  );
}
