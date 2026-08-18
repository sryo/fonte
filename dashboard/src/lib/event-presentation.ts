import type { EventData } from "./api/events";
import type { Tone } from "./status";

const LABELS: Record<string, string> = {
  "message:incoming": "Message received",
  "message:done": "Response sent",
  "agent:invoke": "Agent invoked",
  "agent:response": "Agent response",
  "agent:cancelled": "Agent stopped",
  "torrent:added": "Torrent added",
  "torrent:completed": "Torrent completed",
  "torrent:paused": "Torrent paused",
  "torrent:resumed": "Torrent resumed",
  "torrent:removed": "Torrent removed",
  "torrent:verifying": "Torrent verifying",
  "torrent:reannounced": "Trackers reannounced",
  "torrent:stalled": "Torrent stalled",
  "torrent:stats": "Stats",
  "watchlist:search": "Watchlist search",
  "watchlist:match": "Watchlist match",
  "watchlist:results": "Watchlist results",
  "subtitle:downloaded": "Subtitle downloaded",
  "subtitle:translated": "Subtitle translated",
  "subtitle:error": "Subtitle error",
  "automation:executed": "Automation ran",
  "whatsapp:qr": "WhatsApp QR ready",
  "whatsapp:ready": "WhatsApp connected",
  "whatsapp:disconnected": "WhatsApp disconnected",
};

const TONES: Record<string, Tone> = {
  "message:incoming": "active",
  "message:done": "done",
  "agent:invoke": "active",
  "agent:response": "done",
  "agent:cancelled": "warn",
  "torrent:added": "active",
  "torrent:completed": "done",
  "torrent:paused": "neutral",
  "torrent:resumed": "active",
  "torrent:removed": "neutral",
  "torrent:verifying": "warn",
  "torrent:reannounced": "neutral",
  "torrent:stalled": "warn",
  "watchlist:search": "watch",
  "watchlist:match": "done",
  "watchlist:results": "watch",
  "subtitle:downloaded": "done",
  "subtitle:translated": "done",
  "subtitle:error": "error",
  "automation:executed": "active",
  "whatsapp:qr": "watch",
  "whatsapp:ready": "done",
  "whatsapp:disconnected": "warn",
};

export function eventLabel(type: string): string {
  if (LABELS[type]) return LABELS[type];
  const words = type.replace(/[:_]/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function eventTone(type: string): Tone {
  return TONES[type] ?? "neutral";
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function magnetName(magnetUri: unknown): string | null {
  const uri = str(magnetUri);
  if (!uri) return null;
  const dn = /[?&]dn=([^&]+)/.exec(uri)?.[1];
  if (!dn) return null;
  try {
    return decodeURIComponent(dn.replace(/\+/g, " "));
  } catch {
    return dn;
  }
}

function torrentName(event: EventData): string | null {
  return (
    str(event.name) ??
    magnetName(event.magnetUri) ??
    str(event.infoHash)?.slice(0, 8) ??
    null
  );
}

export function eventDetail(event: EventData): string {
  const parts: unknown[] = [];

  switch (event.type) {
    case "message:incoming":
      parts.push(
        str(event.sender),
        str(event.channel) && `[${str(event.channel)}]`,
        str(event.message) && truncate(str(event.message)!, 60),
      );
      break;
    case "message:done":
      parts.push(
        str(event.agentId) && `@${str(event.agentId)}`,
        str(event.channel),
        num(event.responseLength) && `${num(event.responseLength)} chars`,
      );
      break;
    case "agent:invoke":
      parts.push(
        str(event.agentName) ?? str(event.agentId),
        str(event.fromAgent) && `from @${str(event.fromAgent)}`,
      );
      break;
    case "agent:response":
      parts.push(str(event.agentName) ?? str(event.agentId), str(event.channel));
      break;
    case "agent:cancelled":
      parts.push(str(event.agentId) && `@${str(event.agentId)}`);
      break;
    case "torrent:removed":
      parts.push(torrentName(event), event.filesDeleted ? "files trashed" : "files kept");
      break;
    case "torrent:stalled":
      parts.push(
        torrentName(event),
        num(event.minutesStalled) !== null && `${num(event.minutesStalled)}m`,
        num(event.numPeers) !== null && `${num(event.numPeers)} peers`,
      );
      break;
    case "torrent:added":
    case "torrent:completed":
    case "torrent:paused":
    case "torrent:resumed":
    case "torrent:verifying":
    case "torrent:reannounced":
      parts.push(torrentName(event));
      break;
    case "watchlist:search":
      parts.push(
        str(event.title),
        num(event.resultCount) !== null && `${num(event.resultCount)} results`,
      );
      break;
    case "watchlist:match":
      parts.push(str(event.title), str(event.torrentName));
      break;
    case "watchlist:results":
      parts.push(str(event.title), num(event.count) !== null && `${num(event.count)} new`);
      break;
    case "subtitle:downloaded":
      parts.push(str(event.language));
      break;
    case "subtitle:translated":
      parts.push(
        str(event.sourceLanguage) && str(event.targetLanguage)
          ? `${str(event.sourceLanguage)} → ${str(event.targetLanguage)}`
          : null,
      );
      break;
    case "subtitle:error":
      parts.push(str(event.error) && truncate(str(event.error)!, 60));
      break;
    case "automation:executed":
      parts.push(str(event.ruleName), str(event.triggerEvent));
      break;
    case "whatsapp:disconnected": {
      const reason = str(event.reason) ?? (num(event.reason) !== null ? String(event.reason) : null);
      parts.push(reason && `code ${reason}`);
      break;
    }
  }

  return parts.filter((p): p is string => typeof p === "string" && p.length > 0).join(" · ");
}
