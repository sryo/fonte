"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  FullScreenCalendar,
  type CalendarData,
} from "@/components/ui/fullscreen-calendar";
import {
  getSchedules,
  deleteSchedule,
  type Schedule,
} from "@/lib/api";
import { cronNextOccurrences } from "@/lib/cron";
import { CalendarDots, Trash } from "@phosphor-icons/react";
import { Spinner } from "@/components/ui/feedback";
import { ScheduleFormModal } from "./schedule-form-modal";

export function ScheduleTab({ agentId }: { agentId: string }) {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const loadSchedules = useCallback(() => {
    getSchedules(agentId)
      .then((data) => {
        setSchedules(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [agentId]);

  useEffect(() => {
    loadSchedules();
  }, [loadSchedules]);

  const handleDelete = async (id: string) => {
    try {
      await deleteSchedule(id);
      loadSchedules();
    } catch { /* ignore */ }
  };

  // Convert schedules to calendar data
  const calendarData = useMemo(() => {
    const dayMap = new Map<string, CalendarData>();

    for (const s of schedules) {
      if (!s.enabled) continue;

      if (s.runAt) {
        const occ = new Date(s.runAt);
        const key = occ.toDateString();
        if (!dayMap.has(key)) {
          dayMap.set(key, { day: new Date(occ.getFullYear(), occ.getMonth(), occ.getDate()), events: [] });
        }
        const hours = occ.getHours();
        const mins = occ.getMinutes();
        const ampm = hours >= 12 ? "PM" : "AM";
        const h12 = hours % 12 || 12;
        dayMap.get(key)!.events.push({
          id: s.id,
          name: s.label || s.message.slice(0, 40),
          time: `${h12}:${String(mins).padStart(2, "0")} ${ampm}`,
          datetime: occ.toISOString(),
        });
        continue;
      }

      const occurrences = cronNextOccurrences(s.cron, 60);
      for (const occ of occurrences) {
        const key = occ.toDateString();
        if (!dayMap.has(key)) {
          dayMap.set(key, { day: new Date(occ.getFullYear(), occ.getMonth(), occ.getDate()), events: [] });
        }
        const hours = occ.getHours();
        const mins = occ.getMinutes();
        const ampm = hours >= 12 ? "PM" : "AM";
        const h12 = hours % 12 || 12;
        const timeStr = `${h12}:${String(mins).padStart(2, "0")} ${ampm}`;
        dayMap.get(key)!.events.push({
          id: `${s.id}-${occ.getTime()}`,
          name: s.label || s.message.slice(0, 40),
          time: timeStr,
          datetime: occ.toISOString(),
        });
      }
    }
    return [...dayMap.values()];
  }, [schedules]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          Loading schedules...
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Schedule list bar */}
      {schedules.length > 0 && (
        <div className="flex items-center gap-3 px-6 py-3 border-b bg-card/50">
          <div className="flex items-center gap-2 flex-1 overflow-x-auto">
            {schedules.map((s) => (
              <Badge
                key={s.id}
                variant="outline"
                className="flex items-center gap-2 px-3 py-1.5 text-xs shrink-0"
              >
                <span className={`h-1.5 w-1.5 rounded-full ${s.enabled ? "bg-primary" : "bg-muted-foreground/30"}`} />
                <span className="font-medium">{s.label}</span>
                <span className="text-muted-foreground font-mono">
                  {s.runAt
                    ? new Date(s.runAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
                    : s.cron}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-4 w-4 p-0 ml-1"
                  onClick={() => handleDelete(s.id)}
                >
                  <Trash className="h-3 w-3" />
                </Button>
              </Badge>
            ))}
          </div>
          <span className="text-2xs text-muted-foreground shrink-0">
            {schedules.length} schedule(s)
          </span>
        </div>
      )}

      {/* New schedule form modal */}
      <ScheduleFormModal
        agentId={agentId}
        open={showForm}
        onClose={() => setShowForm(false)}
        onCreated={loadSchedules}
      />

      {/* Calendar */}
      {schedules.length > 0 ? (
        <div className="flex-1">
          <FullScreenCalendar
            data={calendarData}
            onNewEvent={() => setShowForm(true)}
          />
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-muted-foreground">
            <CalendarDots className="h-8 w-8 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No schedules configured</p>
            <p className="text-xs mt-1 mb-4">
              Schedules send recurring tasks to this agent on a cron interval
            </p>
            <Button size="sm" onClick={() => setShowForm(true)}>
              Create Schedule
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
