/**
 * pending: POST in flight, accepted and waiting for its agent_messages echo, or
 * waiting for the daemon to come back.
 * queued: accepted while a run was active, so the agent hasn't picked it up.
 * failed: the daemon rejected it. A row whose message_id shows up in
 * agent_messages is echoed and leaves the outbox.
 */
export type SendPhase = "pending" | "queued" | "failed";

export interface Outbound {
  messageId: string;
  content: string;
  createdAt: number;
  phase: SendPhase;
  error?: string;
  /** Edit-and-rerun origin: truncate from this row before sending. */
  rerunFrom?: number;
  /** The daemon was unreachable; resent on the next successful poll. */
  waiting?: boolean;
}

export function isUnreachable(err: unknown): boolean {
  return err instanceof TypeError;
}

export function afterSendError(err: unknown): Pick<Outbound, "phase" | "waiting" | "error"> {
  if (isUnreachable(err)) return { phase: "pending", waiting: true, error: undefined };
  return { phase: "failed", waiting: false, error: err instanceof Error ? err.message : String(err) };
}

export function takeWaiting(outbox: Outbound[]): { waiting: Outbound[]; outbox: Outbound[] } {
  if (!outbox.some((o) => o.waiting)) return { waiting: [], outbox };
  const waiting: Outbound[] = [];
  const next = outbox.map((o) => {
    if (!o.waiting) return o;
    const resend = { ...o, waiting: false };
    waiting.push(resend);
    return resend;
  });
  return { waiting, outbox: next };
}
