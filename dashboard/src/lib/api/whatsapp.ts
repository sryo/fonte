import { apiFetch } from "./client";

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

export interface WhatsAppChat {
  id: string;
  name: string;
  isGroup: boolean;
  unread: number;
  lastTimestamp?: number;
}

export async function getWhatsAppChats(): Promise<{ ok: boolean; chats: WhatsAppChat[] }> {
  return apiFetch("/api/whatsapp/chats");
}

export async function getAllowedChat(): Promise<{ ok: boolean; allowed_chat: string | null }> {
  return apiFetch("/api/whatsapp/allowed-chat");
}

export async function setAllowedChat(allowed_chat: string | null): Promise<{ ok: boolean; allowed_chat: string | null }> {
  return apiFetch("/api/whatsapp/allowed-chat", {
    method: "POST",
    body: JSON.stringify({ allowed_chat }),
  });
}

export async function requestWhatsAppPairingCode(phone: string): Promise<{ ok: boolean; code: string }> {
  return apiFetch("/api/whatsapp/pair", {
    method: "POST",
    body: JSON.stringify({ phone }),
  });
}
