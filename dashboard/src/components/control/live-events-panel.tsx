"use client";

import { Pulse } from "@phosphor-icons/react";
import { useNow, useSSE } from "@/lib/hooks";
import { eventDetail, eventLabel, eventTone } from "@/lib/event-presentation";
import { formatShortRelativeTime } from "@/lib/format";
import { TONE_TEXT } from "@/lib/status";
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
          <Pulse className="size-5 text-muted-foreground" />
          Live events
          <span className={cn("text-xs font-extrabold", connected ? "text-done" : "text-destructive")}>
            {connected ? "Live" : "Reconnecting"}
          </span>
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
                  <span className={cn("shrink-0 truncate text-xs font-extrabold", TONE_TEXT[eventTone(event.type)])}>
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
