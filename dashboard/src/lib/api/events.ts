import { getApiBase } from "./client";
import { EventHub, type EventData } from "../event-hub";

export type { EventData };

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

let hub: EventHub | null = null;

export function subscribeToEvents(
  onEvent: (event: EventData) => void,
  opts?: {
    onOpen?: () => void;
    onError?: (err: Event) => void;
    onResync?: () => void;
    eventTypes?: string[];
  }
): () => void {
  hub ??= new EventHub(() => new EventSource(`${getApiBase()}/api/events/stream`));
  return hub.subscribe({
    onEvent,
    eventTypes: opts?.eventTypes ?? DEFAULT_EVENT_TYPES,
    onOpen: opts?.onOpen,
    onError: opts?.onError,
    onResync: opts?.onResync,
  });
}
