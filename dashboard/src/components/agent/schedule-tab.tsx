"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  FullScreenCalendar,
  type CalendarData,
} from "@/components/ui/fullscreen-calendar";
import {
  getAutomations,
  deleteAutomation,
  triggerMembers,
  triggerHasSchedule,
  type AutomationRule,
} from "@/lib/api";
import { cronNextOccurrences } from "@/lib/cron";
import { CalendarDots, Trash } from "@phosphor-icons/react";
import { Spinner } from "@/components/ui/feedback";
import { AddAutomationModal } from "@/components/home/add-automation-modal";
import { EditAutomationModal } from "@/components/home/edit-automation-modal";

const SCHEDULE_DRAFT = { trigger: { type: "cron" as const, schedule: "0 9 * * 1-5" } };

function clockLabel(d: Date): string {
  const h12 = d.getHours() % 12 || 12;
  return `${h12}:${String(d.getMinutes()).padStart(2, "0")} ${d.getHours() >= 12 ? "PM" : "AM"}`;
}

export function ScheduleTab({ agentId }: { agentId: string }) {
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<AutomationRule | null>(null);
  const [deleting, setDeleting] = useState<AutomationRule | null>(null);

  const load = useCallback(() => {
    getAutomations({ agent: agentId })
      .then((res) => {
        setRules(res.rules.filter((r) => triggerHasSchedule(r.trigger)));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [agentId]);

  useEffect(() => {
    load();
  }, [load]);

  const calendarData = useMemo(() => {
    const dayMap = new Map<string, CalendarData>();
    const push = (rule: AutomationRule, occ: Date, id: string) => {
      const key = occ.toDateString();
      if (!dayMap.has(key)) {
        dayMap.set(key, { day: new Date(occ.getFullYear(), occ.getMonth(), occ.getDate()), events: [] });
      }
      dayMap.get(key)!.events.push({ id, name: rule.name, time: clockLabel(occ), datetime: occ.toISOString() });
    };

    for (const rule of rules) {
      if (!rule.enabled) continue;
      for (const member of triggerMembers(rule.trigger)) {
        if (member.type === "once") {
          const occ = new Date(member.runAt);
          if (!isNaN(occ.getTime())) push(rule, occ, `${rule.id}-once`);
        } else if (member.type === "cron") {
          for (const occ of cronNextOccurrences(member.schedule, 60)) {
            push(rule, occ, `${rule.id}-${occ.getTime()}`);
          }
        }
      }
    }
    return [...dayMap.values()];
  }, [rules]);

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
      {rules.length > 0 && (
        <div className="flex items-center gap-3 px-6 py-3 border-b bg-card/50">
          <div className="flex items-center gap-2 flex-1 overflow-x-auto">
            {rules.map((rule) => (
              <Badge
                key={rule.id}
                variant="outline"
                role="button"
                tabIndex={0}
                onClick={() => setEditing(rule)}
                onKeyDown={(e) => { if (e.key === "Enter") setEditing(rule); }}
                className="flex items-center gap-2 px-3 py-1.5 text-xs shrink-0 cursor-pointer hover:bg-accent"
              >
                <span className={`h-1.5 w-1.5 rounded-full ${rule.enabled ? "bg-primary" : "bg-muted-foreground/30"}`} />
                <span className="font-medium">{rule.name}</span>
                <span className="text-muted-foreground">{rule.triggerDescription}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete ${rule.name}`}
                  className="h-4 w-4 p-0 ml-1"
                  onClick={(e) => { e.stopPropagation(); setDeleting(rule); }}
                >
                  <Trash className="h-3 w-3" />
                </Button>
              </Badge>
            ))}
          </div>
          <span className="text-2xs text-muted-foreground shrink-0">
            {rules.length} scheduled
          </span>
        </div>
      )}

      <AddAutomationModal
        open={showForm}
        onClose={() => setShowForm(false)}
        onCreated={load}
        agentId={agentId}
        initial={SCHEDULE_DRAFT}
        title="New schedule"
      />

      {editing && (
        <EditAutomationModal
          key={editing.id}
          rule={editing}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="Delete schedule"
        message={<>Delete <b>{deleting?.name}</b>? Its run history goes with it.</>}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          try { await deleteAutomation(deleting.id); } catch {}
          setDeleting(null);
          load();
        }}
        onClose={() => setDeleting(null)}
      />

      {rules.length > 0 ? (
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
            <p className="text-sm">No schedules yet</p>
            <p className="text-xs mt-1 mb-4">
              A schedule is an automation that fires on a cron or at a set time
            </p>
            <Button size="sm" onClick={() => setShowForm(true)}>
              Create schedule
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
