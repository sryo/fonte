"use client";

import { useEffect, useState } from "react";
import { Plug, Warning } from "@phosphor-icons/react";
import { restartJackett, type IndexerStatus } from "@/lib/api";
import { Callout } from "@/components/ui/callout";

const DISMISS_KEY = "fonte.indexer-banner-dismissed";
const JACKETT_URL_FALLBACK = "http://localhost:9117";

function isDown(status: IndexerStatus): boolean {
  return status.reason === "jackett-unreachable" || status.reason === "jackett-error";
}

// Surfaces two distinct Jackett states:
// - down (unreachable/error): a real outage, with a one-click restart. Not
//   dismissible — it should keep showing until Jackett is back.
// - not configured: first-run nudge to pick trackers. Dismissible.
export function IndexerBanner({
  status,
  onRestarted,
}: {
  status: IndexerStatus | null;
  onRestarted?: () => void;
}) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setDismissed(localStorage.getItem(DISMISS_KEY) === "true");
    }
  }, []);

  if (status === null || status.configured) return null;

  const jackettUrl = status.jackettUrl || JACKETT_URL_FALLBACK;

  if (isDown(status)) {
    return <JackettDownBanner jackettUrl={jackettUrl} onRestarted={onRestarted} />;
  }

  if (dismissed) return null;

  const dismiss = () => {
    if (typeof window !== "undefined") {
      localStorage.setItem(DISMISS_KEY, "true");
    }
    setDismissed(true);
  };

  return (
    <Callout
      tone="neutral"
      action={<OpenJackettLink jackettUrl={jackettUrl} />}
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

function JackettDownBanner({
  jackettUrl,
  onRestarted,
}: {
  jackettUrl: string;
  onRestarted?: () => void;
}) {
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const restart = async () => {
    setRestarting(true);
    setError(null);
    try {
      const res = await restartJackett();
      if (!res.ok) throw new Error(res.error || "Restart failed");
      // Jackett's .NET cold start takes ~10s to serve the search API again, so
      // re-check a few times as it warms up. The banner unmounts once status
      // reports configured; if it's still down after the window, drop the busy
      // state so the user can retry. The 30s background poll is the backstop.
      [4000, 9000, 15000].forEach((ms) => setTimeout(() => onRestarted?.(), ms));
      setTimeout(() => setRestarting(false), 16000);
    } catch (err) {
      setError((err as Error).message || "Couldn't restart — is Jackett installed via Homebrew?");
      setRestarting(false);
    }
  };

  return (
    <Callout
      tone="warn"
      action={
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={restart}
            disabled={restarting}
            className="text-xs font-medium px-3 py-1.5 rounded-md bg-foreground text-background hover:opacity-90 transition-opacity disabled:opacity-60"
          >
            {restarting ? "Restarting…" : "Restart Jackett"}
          </button>
          <OpenJackettLink jackettUrl={jackettUrl} />
        </div>
      }
    >
      <div className="flex items-center gap-3">
        <Warning className="h-5 w-5 shrink-0" weight="bold" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">Jackett isn&apos;t responding</p>
          <p className="text-xs">
            {error || "Indexer search is unavailable until it's back."}
          </p>
        </div>
      </div>
    </Callout>
  );
}

function OpenJackettLink({ jackettUrl }: { jackettUrl: string }) {
  return (
    <a
      href={jackettUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="text-xs font-medium underline underline-offset-2 opacity-80 hover:opacity-100 transition-opacity shrink-0"
    >
      Open Jackett ↗
    </a>
  );
}
