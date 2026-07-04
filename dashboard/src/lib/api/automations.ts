import { apiFetch } from "./client";

// ── Automations ─────────────────────────────────────────────────────────

export type TriggerType =
  | "torrent:completed" | "torrent:added" | "torrent:error" | "torrent:stalled"
  | "watchlist:match" | "watchlist:search"
  | "subtitle:downloaded" | "subtitle:translated"
  | "schedule";

export interface AutomationRule {
  id: string;
  name: string;
  prompt: string;
  triggerType: TriggerType;
  triggerConfig: Record<string, unknown>;
  enabled: boolean;
  lastTriggeredAt?: number;
  triggerCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface AutomationLog {
  id: number;
  ruleId: string;
  triggerEvent: string;
  conditionsMet: boolean;
  actionsExecuted: string[];
  errorMessage?: string;
  executedAt: number;
}

export async function getAutomations(): Promise<{ ok: boolean; rules: AutomationRule[] }> {
  return apiFetch("/api/automations");
}

export async function createAutomation(data: { name: string; prompt: string; triggerType: string }): Promise<{ ok: boolean; rule: AutomationRule }> {
  return apiFetch("/api/automations", { method: "POST", body: JSON.stringify(data) });
}

export async function deleteAutomation(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/automations/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function toggleAutomation(id: string): Promise<{ ok: boolean; rule: AutomationRule }> {
  return apiFetch(`/api/automations/${encodeURIComponent(id)}/toggle`, { method: "POST" });
}

export async function triggerAutomation(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/automations/${encodeURIComponent(id)}/trigger`, { method: "POST" });
}

export async function updateAutomation(
  id: string,
  patch: { name?: string; prompt?: string; triggerType?: string; triggerConfig?: Record<string, unknown>; enabled?: boolean },
): Promise<{ ok: boolean; rule: AutomationRule }> {
  return apiFetch(`/api/automations/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });
}

export async function getAutomation(id: string): Promise<{
  ok: boolean;
  rule: AutomationRule;
  logs: AutomationLog[];
  lastResponse: { text: string; ts: number } | null;
}> {
  return apiFetch(`/api/automations/${encodeURIComponent(id)}`);
}
