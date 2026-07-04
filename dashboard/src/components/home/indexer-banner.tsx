"use client";

import { useEffect, useState } from "react";
import { Plug } from "@phosphor-icons/react";
import type { IndexerStatus } from "@/lib/api";
import { Callout } from "@/components/ui/callout";

const DISMISS_KEY = "fonte.indexer-banner-dismissed";

// First-run nudge: no indexers configured in Jackett. Dismissal persists in
// localStorage; read via effect so SSR markup stays stable.
export function IndexerBanner({ status }: { status: IndexerStatus | null }) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setDismissed(localStorage.getItem(DISMISS_KEY) === "true");
    }
  }, []);

  if (status === null || status.configured || dismissed) return null;

  const dismiss = () => {
    if (typeof window !== "undefined") {
      localStorage.setItem(DISMISS_KEY, "true");
    }
    setDismissed(true);
  };

  return (
    <Callout
      tone="neutral"
      action={
        <a
          href={status.jackettUrl || "http://localhost:9117"}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-medium px-3 py-1.5 rounded-md bg-foreground text-background hover:opacity-90 transition-opacity shrink-0"
        >
          Open Jackett
        </a>
      }
      onDismiss={dismiss}
    >
      <div className="flex items-center gap-3">
        <Plug className="h-5 w-5 shrink-0" weight="bold" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">No indexers configured</p>
          <p className="text-xs">
            Fonte ships with none enabled. Open Jackett to pick which trackers to use.
          </p>
        </div>
      </div>
    </Callout>
  );
}
