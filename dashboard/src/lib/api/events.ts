import { getApiBase } from "./client";

export interface EventData {
  type: string;
  timestamp: number;
  [key: string]: unknown;
}

// Every event the daemon actually emits, minus the two high-frequency ticks:
// torrent:stats (3s) and agent:progress (per streaming chunk) would evict real
// events from any capped buffer. Pass eventTypes to subscribe to those.
export const DEFAULT_EVENT_TYPES = [
  "message:incoming", "message:done",
  "agent:invoke", "agent:response", "agent:cancelled",
  "torrent:added", "torrent:completed", "torrent:paused", "torrent:resumed",
  "torrent:removed", "torrent:verifying", "torrent:reannounced", "torrent:stalled",
  "watchlist:search", "watchlist:match", "watchlist:results",
  "subtitle:downloaded", "subtitle:translated", "subtitle:error",
  "automation:executed",
  "whatsapp:qr", "whatsapp:ready", "whatsapp:disconnected",
];

export function subscribeToEvents(
  onEvent: (event: EventData) => void,
  opts?: {
    onOpen?: () => void;
    onError?: (err: Event) => void;
    eventTypes?: string[];
  }
): () => void {
  const es = new EventSource(`${getApiBase()}/api/events/stream`);

  const handler = (e: MessageEvent) => {
    try { onEvent(JSON.parse(e.data)); } catch {}
  };

  for (const type of opts?.eventTypes ?? DEFAULT_EVENT_TYPES) {
    es.addEventListener(type, handler);
  }

  if (opts?.onOpen) es.onopen = opts.onOpen;
  if (opts?.onError) es.onerror = opts.onError;

  return () => es.close();
}
