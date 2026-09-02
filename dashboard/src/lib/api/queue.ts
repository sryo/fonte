import { apiFetch } from "./client";

export interface QueueStatus {
  incoming: number;
  queued: number;
  processing: number;
  outgoing: number;
  activeConversations: number;
}

export interface ProcessingMessage {
  id: number;
  messageId: string;
  channel: string;
  sender: string;
  message: string;
  agent: string;
  status: "pending" | "queued" | "processing";
  lane?: "user" | "background";
  processAlive: boolean;
  startedAt: number;
  duration: number;
}

export interface ResponseData {
  channel: string;
  sender: string;
  message: string;
  originalMessage: string;
  timestamp: number;
  messageId: string;
  agent?: string;
  files?: string[];
}

export interface AgentMessage {
  id: number;
  agent_id: string;
  role: "user" | "assistant";
  channel: string;
  sender: string;
  message_id: string;
  content: string;
  created_at: number;
  /** 'text' | 'tool' (content is JSON {name, input}) | 'system'. Absent on old rows. */
  kind?: string;
  /** Provider session captured for the run this row belongs to. */
  sessionId?: string | null;
}

export async function getQueueStatus(): Promise<QueueStatus> {
  return apiFetch("/api/queue/status", undefined, "status");
}

export async function getProcessingMessages(): Promise<ProcessingMessage[]> {
  return apiFetch("/api/queue/processing", undefined, "messages");
}

export async function killAgentSession(id: number): Promise<{ ok: boolean; agent: string; processKilled: boolean }> {
  return apiFetch(`/api/queue/processing/${id}/kill`, { method: "POST" });
}

/** Terminal, message-scoped stop: no retry, and the partial answer is suppressed. */
export async function cancelAgentRun(id: number): Promise<{ ok: boolean }> {
  return apiFetch(`/api/queue/processing/${id}/cancel`, { method: "POST" });
}

/** Truncate an agent's visible history from a row id onward (edit-and-rerun). */
export async function deleteAgentMessagesFrom(agentId: string, fromId: number): Promise<{ ok: boolean }> {
  return apiFetch(
    `/api/agents/${encodeURIComponent(agentId)}/messages?from=${fromId}`,
    { method: "DELETE" }
  );
}

export async function resetAgent(agentId: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/agents/${encodeURIComponent(agentId)}/reset`, { method: "POST" });
}

export async function getResponses(limit = 20): Promise<ResponseData[]> {
  return apiFetch(`/api/responses?limit=${limit}`, undefined, "responses");
}

export async function getLogs(limit = 100): Promise<{ lines: string[] }> {
  return apiFetch(`/api/logs?limit=${limit}`);
}

export async function sendMessage(payload: {
  message: string;
  agent?: string;
  sender?: string;
  channel?: string;
  /** Client-generated id; a retry with the same id is a no-op server-side. */
  messageId?: string;
  /** Fork the conversation from this provider session (edit-and-rerun). */
  resumeSessionId?: string;
}): Promise<{ ok: boolean; messageId: string }> {
  return apiFetch("/api/message", { method: "POST", body: JSON.stringify(payload) });
}

export async function getAgentMessages(
  agentId: string,
  limit = 100,
  sinceId = 0
): Promise<AgentMessage[]> {
  const params = new URLSearchParams({
    limit: String(limit),
    since_id: String(sinceId),
  });
  return apiFetch(`/api/agents/${encodeURIComponent(agentId)}/messages?${params.toString()}`, undefined, "messages");
}
