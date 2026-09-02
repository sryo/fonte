import { apiFetch } from "./client";

export const AUTOMATION_EVENT_NAMES = [
  "torrent:completed", "torrent:added", "torrent:error", "torrent:stalled", "torrent:removed",
  "watchlist:match", "watchlist:search", "watchlist:results",
  "subtitle:downloaded", "subtitle:translated",
] as const;
export type AutomationEventName = (typeof AUTOMATION_EVENT_NAMES)[number];

export const AUTOMATION_EVENT_LABELS: Record<AutomationEventName, string> = {
  "torrent:completed": "A torrent completes",
  "torrent:added": "A torrent is added",
  "torrent:error": "A torrent errors",
  "torrent:stalled": "A torrent stalls",
  "torrent:removed": "A torrent is removed",
  "watchlist:match": "A watchlist match is added",
  "watchlist:search": "A watchlist entry is searched",
  "watchlist:results": "A watchlist entry gets new results",
  "subtitle:downloaded": "Subtitles are downloaded",
  "subtitle:translated": "Subtitles are translated",
};

export interface EventTrigger { type: "event"; event: AutomationEventName }
export interface CronTrigger { type: "cron"; schedule: string }
export interface OnceTrigger { type: "once"; runAt: string }
export type TriggerMember = EventTrigger | CronTrigger | OnceTrigger;
export interface GroupTrigger { type: "group"; members: TriggerMember[] }
export type AutomationTrigger = TriggerMember | GroupTrigger;

export function triggerMembers(trigger: AutomationTrigger): TriggerMember[] {
  return trigger.type === "group" ? trigger.members : [trigger];
}

export function triggerHasSchedule(trigger: AutomationTrigger): boolean {
  return triggerMembers(trigger).some((m) => m.type === "cron" || m.type === "once");
}

export type AutomationRunTrigger = "event" | "schedule" | "manual";
export type AutomationRunStatus = "running" | "ok" | "error" | "interrupted" | "skipped";

export interface AutomationRun {
  id: string;
  ruleId: string;
  trigger: AutomationRunTrigger;
  eventSummary?: string;
  messageId: string;
  status: AutomationRunStatus;
  detail?: string;
  startedAt: number;
  finishedAt: number | null;
}

export interface AutomationRule {
  id: string;
  name: string;
  prompt: string;
  trigger: AutomationTrigger;
  triggerDescription: string;
  agentId: string;
  enabled: boolean;
  lastTriggeredAt?: number;
  nextRunAt: number | null;
  triggerCount: number;
  createdAt: number;
  updatedAt: number;
  lastRun?: AutomationRun | null;
}

interface AutomationSpec {
  name: string;
  prompt: string;
  trigger: AutomationTrigger;
  agent?: string;
  enabled?: boolean;
}

export async function getAutomations(filter?: { agent?: string; enabled?: boolean }): Promise<{ ok: boolean; rules: AutomationRule[] }> {
  const params = new URLSearchParams();
  if (filter?.agent) params.set("agent", filter.agent);
  if (filter?.enabled !== undefined) params.set("enabled", String(filter.enabled));
  const query = params.toString();
  return apiFetch(`/api/automations${query ? `?${query}` : ""}`);
}

export async function createAutomation(spec: AutomationSpec): Promise<{ ok: boolean; rule: AutomationRule }> {
  return apiFetch("/api/automations", { method: "POST", body: JSON.stringify(spec) });
}

export async function deleteAutomation(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/automations/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function toggleAutomation(id: string): Promise<{ ok: boolean; rule: AutomationRule }> {
  return apiFetch(`/api/automations/${encodeURIComponent(id)}/toggle`, { method: "POST" });
}

export async function triggerAutomation(id: string): Promise<{ ok: boolean; runs: AutomationRun[] }> {
  return apiFetch(`/api/automations/${encodeURIComponent(id)}/trigger`, { method: "POST" });
}

export async function updateAutomation(
  id: string,
  patch: Partial<AutomationSpec>,
): Promise<{ ok: boolean; rule: AutomationRule }> {
  return apiFetch(`/api/automations/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });
}

export async function getAutomation(id: string): Promise<{ ok: boolean; rule: AutomationRule; runs: AutomationRun[] }> {
  return apiFetch(`/api/automations/${encodeURIComponent(id)}`);
}
