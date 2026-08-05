"use client";

import { useCallback, useState } from "react";
import { usePolling } from "@/lib/hooks";
import { cancelAgentRun, getProcessingMessages, type ProcessingMessage } from "@/lib/api";

const sameRun = (a: ProcessingMessage | null, b: ProcessingMessage | null) =>
  a?.id === b?.id && a?.status === b?.status;

/**
 * Live run state for one agent, from the queue's processing list — the
 * server truth behind the stop button and working indicator.
 */
export function useAgentRun(agentId: string, enabled: boolean) {
  const fetchRun = useCallback(async () => {
    const all = await getProcessingMessages();
    return (
      all.find((m) => m.agent === agentId && (m.status === "processing" || m.status === "queued")) ??
      null
    );
  }, [agentId]);

  const { data: run, refresh } = usePolling<ProcessingMessage | null>(
    fetchRun,
    enabled ? 2000 : 0,
    [agentId, enabled],
    sameRun
  );
  const [stopping, setStopping] = useState(false);

  const stop = useCallback(async () => {
    if (!run || stopping) return;
    setStopping(true);
    try {
      await cancelAgentRun(run.id);
      refresh();
    } finally {
      setStopping(false);
    }
  }, [run, stopping, refresh]);

  return { run: run ?? null, stopping, stop };
}
