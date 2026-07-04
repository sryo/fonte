const DEFAULT_API_BASE = "http://localhost:3777";
const STORAGE_KEY = "fonte_api_base";

/** Resolve the API base URL. Priority: env > localStorage > default. */
export function getApiBase(): string {
  // NEXT_PUBLIC_* is inlined at build time, so it can't be overridden later.
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

/** Check if the Fonte API is reachable at the given (or current) base URL. */
export async function checkConnection(baseUrl?: string): Promise<boolean> {
  const base = baseUrl ?? getApiBase();
  try {
    const res = await fetch(`${base}/api/settings`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function apiFetch<T>(path: string, options?: RequestInit, unwrapKey?: string): Promise<T> {
  const API_BASE = getApiBase();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || res.statusText);
  }
  const body = await res.json();
  // Envelope tolerance: routes are migrating to { ok: true, <key>: payload }.
  // With an unwrapKey, accept both the enveloped and the bare legacy shape.
  if (unwrapKey && body && typeof body === "object" && body.ok === true && unwrapKey in body) {
    return body[unwrapKey];
  }
  return body;
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
