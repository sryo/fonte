import { apiFetch } from "./client";

// ── Types ─────────────────────────────────────────────────────────────────

export interface AgentConfig {
  name: string;
  provider: string;
  model: string;
  working_directory: string;
  system_prompt?: string;
  prompt_file?: string;
  heartbeat?: {
    enabled?: boolean;
    interval?: number;
  };
}

export interface Settings {
  workspace?: { path?: string; name?: string };
  models?: {
    provider?: string;
    anthropic?: { model?: string; api_key?: string; oauth_token?: string };
    openai?: { model?: string; api_key?: string };
    opencode?: { model?: string };
  };
  agents?: Record<string, AgentConfig>;
  monitoring?: { heartbeat_interval?: number };
}

// ── API Functions ─────────────────────────────────────────────────────────

export async function getAgents(): Promise<Record<string, AgentConfig>> {
  return apiFetch("/api/agents", undefined, "agents");
}

export async function getSettings(): Promise<Settings> {
  return apiFetch("/api/settings", undefined, "settings");
}

export async function searchRegistrySkills(
  agentId: string,
  query: string
): Promise<{ results: { ref: string; installs?: string; url?: string }[]; raw?: string }> {
  const q = encodeURIComponent(query);
  return apiFetch(`/api/agents/${encodeURIComponent(agentId)}/skills/registry?query=${q}`);
}

export async function installRegistrySkill(
  agentId: string,
  ref: string
): Promise<{ ok: boolean; output: string }> {
  return apiFetch(`/api/agents/${encodeURIComponent(agentId)}/skills/install`, {
    method: "POST",
    body: JSON.stringify({ ref }),
  });
}

export async function updateSettings(settings: Partial<Settings>): Promise<{ ok: boolean; settings: Settings }> {
  return apiFetch("/api/settings", { method: "PUT", body: JSON.stringify(settings) });
}

export async function runSetup(settings: Settings): Promise<{ ok: boolean; settings: Settings }> {
  return apiFetch("/api/setup", { method: "POST", body: JSON.stringify(settings) });
}

export async function saveAgent(
  id: string,
  agent: Partial<AgentConfig> & Pick<AgentConfig, "name" | "provider" | "model">
): Promise<{ ok: boolean; agent: AgentConfig }> {
  return apiFetch(`/api/agents/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(agent),
  });
}

export async function deleteAgent(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/agents/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ── Agent Workspace Data ──────────────────────────────────────────────────

export interface WorkspaceSkill {
  id: string;
  name: string;
  description: string;
}

export async function getAgentSkills(agentId: string): Promise<WorkspaceSkill[]> {
  return apiFetch(`/api/agents/${encodeURIComponent(agentId)}/skills`, undefined, "skills");
}

export async function getAgentSystemPrompt(agentId: string): Promise<{ content: string; path: string }> {
  return apiFetch(`/api/agents/${encodeURIComponent(agentId)}/system-prompt`);
}

export async function saveAgentSystemPrompt(agentId: string, content: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/agents/${encodeURIComponent(agentId)}/system-prompt`, {
    method: "PUT",
    body: JSON.stringify({ content }),
  });
}

export async function getAgentMemory(agentId: string): Promise<{ index: string; files: { name: string; path: string }[]; memoryDir: string }> {
  return apiFetch(`/api/agents/${encodeURIComponent(agentId)}/memory`);
}

export async function getAgentHeartbeat(agentId: string): Promise<{ content: string; path: string; enabled: boolean; interval?: number }> {
  return apiFetch(`/api/agents/${encodeURIComponent(agentId)}/heartbeat`);
}

export async function saveAgentHeartbeat(agentId: string, data: { content?: string; enabled?: boolean; interval?: number }): Promise<{ ok: boolean }> {
  return apiFetch(`/api/agents/${encodeURIComponent(agentId)}/heartbeat`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

// ── Schedules ─────────────────────────────────────────────────────────────

export interface Schedule {
  id: string;
  label: string;
  cron: string;
  agentId: string;
  message: string;
  channel: string;
  sender: string;
  enabled: boolean;
  createdAt: number;
  runAt?: string;
}

export async function getSchedules(agentId?: string): Promise<Schedule[]> {
  const params = agentId ? `?agent=${encodeURIComponent(agentId)}` : "";
  return apiFetch(`/api/schedules${params}`, undefined, "schedules");
}

export async function createSchedule(data: {
  cron?: string;
  runAt?: string;
  agentId: string;
  message: string;
  label?: string;
  channel?: string;
  sender?: string;
}): Promise<{ ok: boolean; schedule: Schedule }> {
  return apiFetch("/api/schedules", { method: "POST", body: JSON.stringify(data) });
}

export async function updateSchedule(
  id: string,
  data: Partial<Omit<Schedule, "id" | "createdAt">>
): Promise<{ ok: boolean; schedule: Schedule }> {
  return apiFetch(`/api/schedules/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteSchedule(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/schedules/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ── Providers ─────────────────────────────────────────────────────────────

export const BUILTIN_PROVIDERS = [
  { id: "anthropic", name: "Anthropic" },
  { id: "openai", name: "OpenAI" },
  { id: "gemini", name: "Gemini" },
  { id: "opencode", name: "OpenCode" },
] as const;

export interface CustomProvider {
  name: string;
  harness: "claude" | "codex";
  base_url: string;
  api_key: string;
  model?: string;
}

export async function getCustomProviders(): Promise<Record<string, CustomProvider>> {
  return apiFetch("/api/custom-providers", undefined, "providers");
}

export async function saveCustomProvider(id: string, provider: CustomProvider): Promise<{ ok: boolean }> {
  return apiFetch(`/api/custom-providers/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(provider),
  });
}

export async function deleteCustomProvider(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/custom-providers/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ── Soul ─────────────────────────────────────────────────────────────────

export async function getSoul(): Promise<{ ok: boolean; content: string; path: string }> {
  return apiFetch("/api/soul");
}

export async function saveSoul(content: string): Promise<{ ok: boolean }> {
  return apiFetch("/api/soul", { method: "PUT", body: JSON.stringify({ content }) });
}
