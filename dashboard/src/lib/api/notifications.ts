import { apiFetch } from "./client";
import type { NotificationDestination } from "../notification-settings";

export async function sendTestNotification(destination: NotificationDestination = "mac"): Promise<{ ok: boolean }> {
  return apiFetch("/api/notifications/test", { method: "POST", body: JSON.stringify({ destination }) });
}
