import { getApiBase } from "./client";

export interface EventData {
  type: string;
  timestamp: number;
  [key: string]: unknown;
}

export function subscribeToEvents(
  onEvent: (event: EventData) => void,
  onError?: (err: Event) => void,
  eventTypes?: string[]
): () => void {
  const es = new EventSource(`${getApiBase()}/api/events/stream`);

  const handler = (e: MessageEvent) => {
    try { onEvent(JSON.parse(e.data)); } catch {}
  };

  const types = eventTypes ?? [
    "message:incoming", "agent:invoke", "agent:progress",
    "agent:response", "agent:mention", "agent:cancelled", "message:done",
    "torrent:added", "torrent:progress", "torrent:completed",
    "torrent:paused", "torrent:resumed", "torrent:removed",
    "torrent:error", "torrent:stats",
    "watchlist:search", "watchlist:match", "watchlist:results", "watchlist:added", "watchlist:removed",
    "subtitle:downloaded", "subtitle:translated", "subtitle:error",
  ];
  for (const type of types) {
    es.addEventListener(type, handler);
  }

  if (onError) es.onerror = onError;

  return () => es.close();
}
