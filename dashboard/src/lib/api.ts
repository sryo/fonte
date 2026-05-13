const DEFAULT_API_BASE = "http://localhost:3777";
const STORAGE_KEY = "aitorrent_api_base";

/** Resolve the API base URL. Priority: env > localStorage > default. */
export function getApiBase(): string {
  // Env var always wins (set at build time via NEXT_PUBLIC_*)
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return stored;
  }
  return DEFAULT_API_BASE;
}

/** Persist a custom API base URL in localStorage. Pass null to reset to default. */
export function setApiBase(url: string | null): void {
  if (url) {
    localStorage.setItem(STORAGE_KEY, url);
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

/** Check if the AITorrent API is reachable at the given (or current) base URL. */
export async function checkConnection(baseUrl?: string): Promise<boolean> {
  const base = baseUrl ?? getApiBase();
  try {
    const res = await fetch(`${base}/api/settings`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const API_BASE = getApiBase();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || res.statusText);
  }
  return res.json();
}

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
  status: "queued" | "processing";
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

export interface EventData {
  type: string;
  timestamp: number;
  [key: string]: unknown;
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
}

// ── API Functions ─────────────────────────────────────────────────────────

export async function getAgents(): Promise<Record<string, AgentConfig>> {
  return apiFetch("/api/agents");
}

export async function getSettings(): Promise<Settings> {
  return apiFetch("/api/settings");
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

export async function getQueueStatus(): Promise<QueueStatus> {
  return apiFetch("/api/queue/status");
}

export async function getProcessingMessages(): Promise<ProcessingMessage[]> {
  return apiFetch("/api/queue/processing");
}

export async function killAgentSession(id: number): Promise<{ ok: boolean; agent: string; processKilled: boolean }> {
  return apiFetch(`/api/queue/processing/${id}/kill`, { method: "POST" });
}

export async function getResponses(limit = 20): Promise<ResponseData[]> {
  return apiFetch(`/api/responses?limit=${limit}`);
}

export async function getLogs(limit = 100): Promise<{ lines: string[] }> {
  return apiFetch(`/api/logs?limit=${limit}`);
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

export async function sendMessage(payload: {
  message: string;
  agent?: string;
  sender?: string;
  channel?: string;
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
  return apiFetch(`/api/agents/${encodeURIComponent(agentId)}/messages?${params.toString()}`);
}

// ── Agent Workspace Data ──────────────────────────────────────────────────

export interface WorkspaceSkill {
  id: string;
  name: string;
  description: string;
}

export async function getAgentSkills(agentId: string): Promise<WorkspaceSkill[]> {
  return apiFetch(`/api/agents/${encodeURIComponent(agentId)}/skills`);
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
  return apiFetch(`/api/schedules${params}`);
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

// ── Control Plane ─────────────────────────────────────────────────────────

export async function getSystemStatus(): Promise<{
  ok: boolean;
  uptime: number;
  server: { running: boolean; port: number };
}> {
  return apiFetch("/api/status");
}

export async function restartService(): Promise<{ ok: boolean; action: string }> {
  return apiFetch("/api/services/restart", { method: "POST" });
}

// ── Custom Providers ──────────────────────────────────────────────────────

export interface CustomProvider {
  name: string;
  harness: "claude" | "codex";
  base_url: string;
  api_key: string;
  model?: string;
}

export async function getCustomProviders(): Promise<Record<string, CustomProvider>> {
  return apiFetch("/api/custom-providers");
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

// ── Torrents ─────────────────────────────────────────────────────────────

export type TorrentStatus = "adding" | "downloading" | "seeding" | "paused" | "completed" | "error" | "removed";

export interface TorrentRecord {
  id: string;
  infoHash: string;
  name: string;
  magnetUri?: string;
  status: TorrentStatus;
  progress: number;
  downloadSpeed: number;
  uploadSpeed: number;
  downloaded: number;
  uploaded: number;
  size: number;
  numPeers: number;
  savePath: string;
  addedAt: number;
  completedAt?: number;
  errorMessage?: string;
  tags?: string[];
}

export interface TorrentFileRecord {
  name: string;
  path: string;
  size: number;
  progress: number;
  selected: boolean;
}

export interface TorrentConfig {
  download_dir: string;
  max_concurrent: number;
  max_download_speed: number;
  max_upload_speed: number;
  seed_ratio_limit: number;
  auto_start: boolean;
  port: number;
  dht: boolean;
}

export interface TorrentStats {
  downloadSpeed: number;
  uploadSpeed: number;
  activeTorrents: number;
  totalTorrents: number;
}

export async function getTorrents(status?: TorrentStatus): Promise<{ ok: boolean; torrents: TorrentRecord[] }> {
  const params = status ? `?status=${status}` : "";
  return apiFetch(`/api/torrents${params}`);
}

export async function getTorrent(id: string): Promise<{ ok: boolean; torrent: TorrentRecord }> {
  return apiFetch(`/api/torrents/${encodeURIComponent(id)}`);
}

export async function addTorrent(data: { magnetUri?: string; infoHash?: string }): Promise<{ ok: boolean; torrent: TorrentRecord }> {
  return apiFetch("/api/torrents", { method: "POST", body: JSON.stringify(data) });
}

export async function pauseTorrent(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/torrents/${encodeURIComponent(id)}/pause`, { method: "POST" });
}

export async function resumeTorrent(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/torrents/${encodeURIComponent(id)}/resume`, { method: "POST" });
}

export async function removeTorrent(id: string, deleteFiles = false): Promise<{ ok: boolean }> {
  const params = deleteFiles ? "?deleteFiles=true" : "";
  return apiFetch(`/api/torrents/${encodeURIComponent(id)}${params}`, { method: "DELETE" });
}

export async function getTorrentFiles(id: string): Promise<{ ok: boolean; files: TorrentFileRecord[] }> {
  return apiFetch(`/api/torrents/${encodeURIComponent(id)}/files`);
}

export async function getTorrentStats(): Promise<{ ok: boolean } & TorrentStats> {
  return apiFetch("/api/torrents/stats");
}

export async function getTorrentConfig(): Promise<{ ok: boolean; config: TorrentConfig }> {
  return apiFetch("/api/torrents/config");
}

export async function updateTorrentConfig(config: Partial<TorrentConfig>): Promise<{ ok: boolean; config: TorrentConfig }> {
  return apiFetch("/api/torrents/config", { method: "PUT", body: JSON.stringify(config) });
}

// ── Watchlist ────────────────────────────────────────────────────────────

export type WatchlistStatus = "watching" | "fulfilled" | "paused";
export type MediaType = "movie" | "tv" | "music" | "game" | "book" | "app" | "other";

export interface WatchlistRecord {
  id: string;
  title: string;
  mediaType: MediaType;
  year?: number;
  seasonPattern?: string;
  quality: string;
  searchQuery: string;
  category: number;
  enabled: boolean;
  status: WatchlistStatus;
  posterUrl?: string;
  lastCheckedAt?: number;
  lastMatchAt?: number;
  matchedTorrentId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface WatchlistResultRecord {
  id: number;
  watchlistId: string;
  title: string;
  magnetUri: string;
  seeders: number;
  leechers: number;
  size: number;
  qualityMatch: number;
  publishDate?: number;
  indexer?: string;
  wasSelected: boolean;
  foundAt: number;
}

export type SubtitleStatus = "pending" | "downloading" | "downloaded" | "translating" | "translated" | "error";

export interface SubtitleRecord {
  id: number;
  torrentId: string;
  filePath: string;
  language: string;
  isOriginal: boolean;
  sourceSubtitleId?: number;
  status: SubtitleStatus;
  errorMessage?: string;
  createdAt: number;
  updatedAt: number;
}

export async function getWatchlist(status?: WatchlistStatus): Promise<{ ok: boolean; entries: WatchlistRecord[] }> {
  const params = status ? `?status=${status}` : "";
  return apiFetch(`/api/watchlist${params}`);
}

export async function getWatchlistEntry(id: string): Promise<{ ok: boolean; entry: WatchlistRecord; results: WatchlistResultRecord[] }> {
  return apiFetch(`/api/watchlist/${encodeURIComponent(id)}`);
}

export async function addWatchlistEntry(data: { title: string; mediaType: MediaType; year?: number; quality?: string; seasonPattern?: string }): Promise<{ ok: boolean; entry: WatchlistRecord }> {
  return apiFetch("/api/watchlist", { method: "POST", body: JSON.stringify(data) });
}

export async function updateWatchlistEntry(id: string, data: Partial<WatchlistRecord>): Promise<{ ok: boolean; entry: WatchlistRecord }> {
  return apiFetch(`/api/watchlist/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(data) });
}

export async function deleteWatchlistEntry(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/watchlist/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function triggerWatchlistSearch(id: string): Promise<{ ok: boolean; results: WatchlistResultRecord[] }> {
  return apiFetch(`/api/watchlist/${encodeURIComponent(id)}/search`, { method: "POST" });
}

export async function triggerWatchlistCheck(): Promise<{ ok: boolean }> {
  return apiFetch("/api/watchlist/check", { method: "POST" });
}

export async function addWatchlistResult(watchlistId: string, resultId: number): Promise<{ ok: boolean }> {
  return apiFetch(`/api/watchlist/${encodeURIComponent(watchlistId)}/results/${resultId}/add`, { method: "POST" });
}

export async function getTorrentSubtitles(torrentId: string): Promise<{ ok: boolean; subtitles: SubtitleRecord[] }> {
  return apiFetch(`/api/torrents/${encodeURIComponent(torrentId)}/subtitles`);
}

export async function fetchTorrentSubtitles(torrentId: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/torrents/${encodeURIComponent(torrentId)}/subtitles/fetch`, { method: "POST" });
}

export async function translateSubtitleApi(subtitleId: number, language: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/subtitles/${subtitleId}/translate`, { method: "POST", body: JSON.stringify({ language }) });
}

export async function deleteSubtitleApi(subtitleId: number): Promise<{ ok: boolean }> {
  return apiFetch(`/api/subtitles/${subtitleId}`, { method: "DELETE" });
}

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

// ── Soul ─────────────────────────────────────────────────────────────────

export async function getSoul(): Promise<{ ok: boolean; content: string; path: string }> {
  return apiFetch("/api/soul");
}

export async function saveSoul(content: string): Promise<{ ok: boolean }> {
  return apiFetch("/api/soul", { method: "PUT", body: JSON.stringify({ content }) });
}

// ── WhatsApp ─────────────────────────────────────────────────────────
export async function startWhatsApp(): Promise<{ ok: boolean; status: string }> {
  return apiFetch("/api/whatsapp/start", { method: "POST" });
}

export async function getWhatsAppStatus(): Promise<{ ok: boolean; status: string; qr?: string }> {
  return apiFetch("/api/whatsapp/status");
}

export async function stopWhatsApp(): Promise<{ ok: boolean }> {
  return apiFetch("/api/whatsapp/disconnect", { method: "POST" });
}

// ── SSE ───────────────────────────────────────────────────────────────────

export function subscribeToEvents(
  onEvent: (event: EventData) => void,
  onError?: (err: Event) => void,
  eventTypes?: string[]
): () => void {
  const es = new EventSource(`${getApiBase()}/api/events/stream`);

  const handler = (e: MessageEvent) => {
    try { onEvent(JSON.parse(e.data)); } catch { /* ignore parse errors */ }
  };

  // Listen to all known event types
  const types = eventTypes ?? [
    "message:incoming", "agent:invoke", "agent:progress",
    "agent:response", "agent:mention", "message:done",
    "torrent:added", "torrent:progress", "torrent:completed",
    "torrent:paused", "torrent:resumed", "torrent:removed",
    "torrent:error", "torrent:stats",
    "watchlist:search", "watchlist:match", "watchlist:added", "watchlist:removed",
    "subtitle:downloaded", "subtitle:translated", "subtitle:error",
  ];
  for (const type of types) {
    es.addEventListener(type, handler);
  }

  if (onError) es.onerror = onError;

  return () => es.close();
}
