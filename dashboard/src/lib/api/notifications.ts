import { apiFetch } from "./client";

export async function sendTestNotification(): Promise<{ ok: boolean }> {
  return apiFetch("/api/notifications/test", { method: "POST" });
}
