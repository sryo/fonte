"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cancelAgentRun,
  deleteAgentMessagesFrom,
  getAgentMessages,
  getProcessingMessages,
  resetAgent,
  sendMessage,
  subscribeToEvents,
  type AgentMessage,
  type EventData,
  type ProcessingMessage,
} from "@/lib/api";
import { groupActivity } from "@/lib/agent-activity";

/**
 * pending: POST in flight, or accepted and waiting for its agent_messages echo.
 * queued: accepted while a run was active, so the agent hasn't picked it up.
 * failed: POST rejected or the network dropped. A row whose message_id shows up
 * in agent_messages is echoed and leaves the outbox.
 */
export type SendPhase = "pending" | "queued" | "failed";

export interface ChatMessage {
  /** agent_messages row id, or `local-<messageId>` for an unechoed send. */
  id: number | string;
  role: "user" | "assistant";
  content: string;
  created_at: number;
  sender?: string;
  channel?: string;
  message_id?: string;
  kind?: string;
  sessionId?: string | null;
  local?: { phase: SendPhase; error?: string };
}

export interface QueuedMessage {
  key: string;
  /** Queue row id for POST /api/queue/processing/:id/cancel. Null until the queue poll sees it. */
  queueId: number | null;
  messageId: string;
  content: string;
}

interface Outbound {
  messageId: string;
  content: string;
  createdAt: number;
  phase: SendPhase;
  error?: string;
  /** Edit-and-rerun origin: truncate from this row before sending. */
  rerunFrom?: number;
}

const POLL_MS = 3000;
const SSE_DEBOUNCE_MS = 150;

// agent:progress is deliberately outside DEFAULT_EVENT_TYPES; the chat wants
// it so tool rows land as they happen.
const CHAT_EVENT_TYPES = [
  "message:incoming",
  "message:done",
  "agent:invoke",
  "agent:progress",
  "agent:response",
  "agent:cancelled",
  "agent:error",
];

function eventTargets(event: EventData, agentId: string): boolean {
  return event.agentId === agentId || event.agent === agentId;
}

function stripAgentPrefix(content: string, agentId: string): string {
  const spaced = `@${agentId} `;
  if (content.startsWith(spaced)) return content.slice(spaced.length);
  const newline = `@${agentId}\n`;
  if (content.startsWith(newline)) return content.slice(newline.length);
  return content;
}

function sameRows(a: AgentMessage[], b: AgentMessage[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.id !== y.id || x.content !== y.content || x.kind !== y.kind || x.sessionId !== y.sessionId) {
      return false;
    }
  }
  return true;
}

function sameProcessing(a: ProcessingMessage[], b: ProcessingMessage[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].status !== b[i].status) return false;
  }
  return true;
}

const newMessageId = () => `web_${crypto.randomUUID()}`;

/**
 * One agent's chat: transcript, live run, queued sends, and the send journal.
 * Refreshes on SSE events for this agent with an interval poll as fallback.
 */
export function useAgentChat(agentId: string, opts: { active: boolean; limit?: number }) {
  const { active, limit = 200 } = opts;

  const [serverRows, setServerRows] = useState<AgentMessage[]>([]);
  const [processing, setProcessing] = useState<ProcessingMessage[]>([]);
  const [outbox, setOutbox] = useState<Outbound[]>([]);
  const [pollError, setPollError] = useState<string | null>(null);
  const [inFlightSends, setInFlightSends] = useState(0);
  const [stopping, setStopping] = useState(false);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [editingRowId, setEditingRowId] = useState<number | null>(null);

  const agentRef = useRef(agentId);
  const serverRowsRef = useRef(serverRows);
  const runRef = useRef<ProcessingMessage | null>(null);
  const refreshing = useRef(false);
  const dirty = useRef(false);
  const sseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Switching agents drops the previous transcript in the same render.
  const [shownAgent, setShownAgent] = useState(agentId);
  if (shownAgent !== agentId) {
    setShownAgent(agentId);
    setServerRows([]);
    setProcessing([]);
    setOutbox([]);
    setEditingRowId(null);
    setPollError(null);
  }

  useEffect(() => {
    agentRef.current = agentId;
  }, [agentId]);

  const refresh = useCallback(async () => {
    if (refreshing.current) {
      dirty.current = true;
      return;
    }
    refreshing.current = true;
    try {
      do {
        dirty.current = false;
        const [rows, procs] = await Promise.all([
          getAgentMessages(agentId, limit),
          getProcessingMessages(),
        ]);
        if (agentRef.current !== agentId) return;
        const ordered = [...rows].sort((a, b) => a.created_at - b.created_at || a.id - b.id);
        serverRowsRef.current = ordered;
        setServerRows((prev) => (sameRows(prev, ordered) ? prev : ordered));
        const mine = procs.filter((p) => p.agent === agentId);
        setProcessing((prev) => (sameProcessing(prev, mine) ? prev : mine));
        setPollError(null);
        const echoed = new Set(ordered.map((r) => r.message_id));
        setOutbox((prev) =>
          prev.some((o) => echoed.has(o.messageId)) ? prev.filter((o) => !echoed.has(o.messageId)) : prev
        );
      } while (dirty.current);
    } catch (err) {
      if (agentRef.current === agentId) setPollError((err as Error).message);
    } finally {
      refreshing.current = false;
    }
  }, [agentId, limit]);

  useEffect(() => {
    if (!active) return;
    const first = setTimeout(refresh, 0);
    const id = setInterval(refresh, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [active, refresh]);

  useEffect(() => {
    if (!active) return;
    const unsubscribe = subscribeToEvents(
      (event) => {
        if (!eventTargets(event, agentId)) return;
        if (sseTimer.current) clearTimeout(sseTimer.current);
        sseTimer.current = setTimeout(() => {
          sseTimer.current = null;
          refresh();
        }, SSE_DEBOUNCE_MS);
      },
      { eventTypes: CHAT_EVENT_TYPES }
    );
    return () => {
      unsubscribe();
      if (sseTimer.current) clearTimeout(sseTimer.current);
      sseTimer.current = null;
    };
  }, [active, agentId, refresh]);

  const run = useMemo(
    () =>
      processing.find((p) => p.status === "processing") ??
      processing.find((p) => p.status === "queued") ??
      processing.find((p) => p.status === "pending") ??
      null,
    [processing]
  );
  useEffect(() => {
    runRef.current = run;
  }, [run]);

  const stop = useCallback(async () => {
    if (!run || stopping) return;
    setStopping(true);
    try {
      await cancelAgentRun(run.id);
      await refresh();
    } finally {
      setStopping(false);
    }
  }, [run, stopping, refresh]);

  const patchOutbound = useCallback((messageId: string, patch: Partial<Outbound>) => {
    setOutbox((prev) => prev.map((o) => (o.messageId === messageId ? { ...o, ...patch } : o)));
  }, []);

  const deliver = useCallback(
    async (outbound: Outbound) => {
      const { messageId, content, rerunFrom } = outbound;
      setInFlightSends((n) => n + 1);
      try {
        let resumeSessionId: string | undefined;
        if (rerunFrom != null) {
          // Stop the in-flight run, truncate history from the edited row, and
          // fork from the previous run's provider session, or reset for a
          // fresh conversation when none was captured.
          const current = runRef.current;
          if (current) await cancelAgentRun(current.id);
          const fork = serverRowsRef.current.findLast((m) => m.id < rerunFrom && m.sessionId)?.sessionId;
          if (!fork) await resetAgent(agentId);
          await deleteAgentMessagesFrom(agentId, rerunFrom);
          resumeSessionId = fork ?? undefined;
        }
        try {
          await sendMessage({
            message: content,
            agent: agentId,
            channel: "web",
            sender: "Web",
            messageId,
            resumeSessionId,
          });
        } catch (err) {
          // The first attempt reached the server even though its reply didn't
          // reach us, so the retry is already delivered.
          if (!/duplicate messageId/i.test((err as Error).message)) throw err;
        }
        patchOutbound(messageId, { phase: runRef.current ? "queued" : "pending", error: undefined });
        await refresh();
      } catch (err) {
        patchOutbound(messageId, { phase: "failed", error: (err as Error).message });
      } finally {
        setInFlightSends((n) => n - 1);
      }
    },
    [agentId, patchOutbound, refresh]
  );

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content) return;
      const outbound: Outbound = {
        messageId: newMessageId(),
        content,
        createdAt: Date.now(),
        phase: "pending",
        rerunFrom: editingRowId ?? undefined,
      };
      setEditingRowId(null);
      setOutbox((prev) => [...prev, outbound]);
      await deliver(outbound);
    },
    [editingRowId, deliver]
  );

  const retry = useCallback(
    (messageId: string) => {
      const outbound = outbox.find((o) => o.messageId === messageId);
      if (!outbound || outbound.phase !== "failed") return;
      patchOutbound(messageId, { phase: "pending", error: undefined });
      void deliver({ ...outbound, phase: "pending", error: undefined });
    },
    [outbox, patchOutbound, deliver]
  );

  const discard = useCallback((messageId: string) => {
    setOutbox((prev) => prev.filter((o) => o.messageId !== messageId));
  }, []);

  const cancelQueued = useCallback(
    async (queueId: number) => {
      setCancellingId(queueId);
      try {
        await cancelAgentRun(queueId);
        await refresh();
      } finally {
        setCancellingId((id) => (id === queueId ? null : id));
      }
    },
    [refresh]
  );

  const reset = useCallback(async () => {
    setEditingRowId(null);
    await resetAgent(agentId);
    await refresh();
  }, [agentId, refresh]);

  const startEditing = useCallback((rowId: number) => setEditingRowId(rowId), []);
  const cancelEditing = useCallback(() => setEditingRowId(null), []);

  const messages = useMemo<ChatMessage[]>(() => {
    const rows: ChatMessage[] = serverRows.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.role === "user" ? stripAgentPrefix(m.content, agentId) : m.content,
      created_at: m.created_at,
      sender: m.sender,
      channel: m.channel,
      message_id: m.message_id,
      kind: m.kind,
      sessionId: m.sessionId,
    }));
    for (const o of outbox) {
      if (o.phase === "queued") continue;
      rows.push({
        id: `local-${o.messageId}`,
        role: "user",
        content: o.content,
        created_at: o.createdAt,
        sender: "Web",
        channel: "web",
        message_id: o.messageId,
        kind: "text",
        local: { phase: o.phase, error: o.error },
      });
    }
    return rows;
  }, [serverRows, outbox, agentId]);

  const items = useMemo(() => groupActivity(messages), [messages]);

  const queued = useMemo<QueuedMessage[]>(() => {
    const list: QueuedMessage[] = processing
      .filter((p) => (p.status === "queued" || p.status === "pending") && p !== run && p.channel === "web")
      .map((p) => ({
        key: `queue-${p.id}`,
        queueId: p.id,
        messageId: p.messageId,
        content: stripAgentPrefix(p.message, agentId),
      }));
    const known = new Set(list.map((q) => q.messageId));
    for (const o of outbox) {
      if (o.phase !== "queued" || known.has(o.messageId)) continue;
      list.push({ key: `local-${o.messageId}`, queueId: null, messageId: o.messageId, content: o.content });
    }
    return list;
  }, [processing, run, outbox, agentId]);

  const editableRowId = useMemo(
    () =>
      serverRows.findLast(
        (m) => m.role === "user" && m.channel === "web" && (m.kind === undefined || m.kind === "text")
      )?.id,
    [serverRows]
  );

  return {
    messages,
    items,
    run,
    stopping,
    stop,
    queued,
    cancellingId,
    cancelQueued,
    send,
    retry,
    discard,
    sending: inFlightSends > 0,
    editingRowId,
    editableRowId,
    startEditing,
    cancelEditing,
    reset,
    refresh,
    error: pollError,
  };
}
