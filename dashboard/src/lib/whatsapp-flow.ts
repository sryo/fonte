export type WhatsAppStatus = "disconnected" | "connecting" | "waiting_qr" | "connected";
export type WhatsAppDisconnectReason = "logged_out" | "qr_expired" | "replaced" | "connection_failed";
export type WhatsAppPanel = "link" | "paused" | "starting" | "qr" | "pairing" | "connected";

export interface WhatsAppStatusInfo {
  status: WhatsAppStatus;
  linked: boolean;
  qr?: string;
  reason?: WhatsAppDisconnectReason;
}

export interface WhatsAppChatOption {
  id: string;
  name: string;
  isGroup: boolean;
  unread: number;
  lastTimestamp?: number;
}

const STATUSES: readonly WhatsAppStatus[] = ["disconnected", "connecting", "waiting_qr", "connected"];

const DISCONNECT_MESSAGES: Record<WhatsAppDisconnectReason, string> = {
  logged_out: "WhatsApp unlinked this device. Link it again to keep using Fonte from your phone.",
  qr_expired: "The code expired before it was used. Start again for a new one.",
  replaced: "Another session took over this WhatsApp link. Reconnect to take it back.",
  connection_failed: "Couldn't reach WhatsApp. Check your connection and try again.",
};

export function parseWhatsAppStatus(raw: object): WhatsAppStatusInfo {
  const data = raw as Record<string, unknown>;
  const status = STATUSES.includes(data.status as WhatsAppStatus)
    ? (data.status as WhatsAppStatus)
    : "disconnected";
  const reason = typeof data.reason === "string" && data.reason in DISCONNECT_MESSAGES
    ? (data.reason as WhatsAppDisconnectReason)
    : undefined;
  return {
    status,
    linked: data.linked === true,
    qr: typeof data.qr === "string" && data.qr ? data.qr : undefined,
    reason,
  };
}

export function whatsAppPanel({
  status,
  linked,
  pairing,
}: {
  status: WhatsAppStatus;
  linked: boolean;
  pairing: boolean;
}): WhatsAppPanel {
  if (status === "connected") return "connected";
  if (pairing) return "pairing";
  if (status === "waiting_qr") return "qr";
  if (status === "connecting") return "starting";
  return linked ? "paused" : "link";
}

export function disconnectMessage(reason: WhatsAppDisconnectReason | undefined): string | null {
  return reason ? DISCONNECT_MESSAGES[reason] : null;
}

export function startingLabel(linked: boolean): string {
  return linked ? "Reconnecting to WhatsApp…" : "Starting WhatsApp…";
}

export function keepPairingCode(code: string | null, status: WhatsAppStatus): string | null {
  return status === "disconnected" ? null : code;
}

export function chatOptions(chats: WhatsAppChatOption[], selected: string | null): WhatsAppChatOption[] {
  if (!selected || chats.some((c) => c.id === selected)) return chats;
  return [
    { id: selected, name: "Saved chat (not found)", isGroup: selected.endsWith("@g.us"), unread: 0 },
    ...chats,
  ];
}
