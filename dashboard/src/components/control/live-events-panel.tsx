"use client";

import { Pulse } from "@phosphor-icons/react";
import { useNow, useSSE } from "@/lib/hooks";
import { eventDetail, eventLabel, eventTone } from "@/lib/event-presentation";
import { formatShortRelativeTime } from "@/lib/format";
import { TONE_DOT } from "@/lib/status";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/feedback";
import { Section } from "@/components/ui/section";

export function LiveEventsPanel() {
  const { events, connected } = useSSE(100);
  useNow(5000);

  return (
    <Section
      title={
        <>
          <Pulse className="h-3.5 w-3.5" />
          Live events
          <span
            title={connected ? "Connected" : "Reconnecting"}
            className={cn("h-1.5 w-1.5 rounded-full", connected ? TONE_DOT.done : TONE_DOT.error)}
          />
        </>
      }
      count={events.length}
    >
      <div className="max-h-[40vh] overflow-y-auto">
        {events.length > 0 ? (
          <div className="divide-y">
            {events.map((event, i) => {
              const detail = eventDetail(event);
              return (
                <div
                  key={`${event.timestamp}-${i}`}
                  className="flex items-center gap-2.5 px-1 py-2 text-sm"
                >
                  <div
                    className={cn("h-1.5 w-1.5 shrink-0 rounded-full", TONE_DOT[eventTone(event.type)])}
                  />
                  <span className="shrink-0 truncate text-xs font-medium">
                    {eventLabel(event.type)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {detail}
                  </span>
                  <span className="shrink-0 whitespace-nowrap text-2xs text-muted-foreground">
                    {formatShortRelativeTime(event.timestamp)}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={Pulse}
            title="Waiting for events"
            hint="Events appear here as the daemon works."
          />
        )}
      </div>
    </Section>
  );
}
