"use client";

import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AUTOMATION_EVENT_LABELS,
  AUTOMATION_EVENT_NAMES,
  triggerMembers,
  type AutomationEventName,
  type AutomationTrigger,
  type TriggerMember,
} from "@/lib/api";
import {
  DEFAULT_SCHEDULE_FORM,
  DAYS_OF_WEEK,
  describeSchedule,
  ordinal,
  parseCronToForm,
  scheduleFormToCron,
  type RepeatMode,
  type ScheduleForm,
} from "@/lib/cron";
import { Calendar as CalendarIcon, Clock, Plus, X } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

export type TriggerMemberForm =
  | { kind: "event"; event: AutomationEventName }
  | { kind: "cron"; form: ScheduleForm }
  | { kind: "once"; date: Date | undefined; time: string };

const MAX_MEMBERS = 8;
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

export function defaultMember(kind: TriggerMemberForm["kind"]): TriggerMemberForm {
  switch (kind) {
    case "event": return { kind, event: "torrent:completed" };
    case "cron": return { kind, form: { ...DEFAULT_SCHEDULE_FORM } };
    case "once": return { kind, date: undefined, time: "09:00" };
  }
}

export function membersFromTrigger(trigger: AutomationTrigger): TriggerMemberForm[] {
  return triggerMembers(trigger).map((m): TriggerMemberForm => {
    if (m.type === "event") return { kind: "event", event: m.event };
    if (m.type === "cron") return { kind: "cron", form: parseCronToForm(m.schedule) };
    const d = new Date(m.runAt);
    return {
      kind: "once",
      date: isNaN(d.getTime()) ? undefined : d,
      time: isNaN(d.getTime()) ? "09:00" : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
    };
  });
}

function memberToTrigger(m: TriggerMemberForm): TriggerMember | null {
  if (m.kind === "event") return { type: "event", event: m.event };
  if (m.kind === "cron") {
    const schedule = scheduleFormToCron(m.form).trim();
    return schedule ? { type: "cron", schedule } : null;
  }
  if (!m.date) return null;
  const [hours, minutes] = (m.time || "09:00").split(":").map(Number);
  const d = new Date(m.date);
  d.setHours(hours, minutes, 0, 0);
  return { type: "once", runAt: d.toISOString() };
}

export function membersToTrigger(members: TriggerMemberForm[]): AutomationTrigger | null {
  const parsed = members.map(memberToTrigger);
  if (parsed.length === 0 || parsed.some((m) => m === null)) return null;
  const list = parsed as TriggerMember[];
  return list.length === 1 ? list[0] : { type: "group", members: list };
}

function describeMember(m: TriggerMemberForm): string {
  if (m.kind === "event") return AUTOMATION_EVENT_LABELS[m.event];
  if (m.kind === "cron") {
    return describeSchedule({ ...m.form, runAtDate: undefined, runAtTime: "" });
  }
  return describeSchedule({ ...DEFAULT_SCHEDULE_FORM, repeat: "once", runAtDate: m.date, runAtTime: m.time });
}

function ScheduleFields({ form, onChange }: { form: ScheduleForm; onChange: (next: ScheduleForm) => void }) {
  const set = (patch: Partial<ScheduleForm>) => onChange({ ...form, ...patch });
  return (
    <div className="space-y-2">
      <Select value={form.repeat} onValueChange={(v) => set({ repeat: v as RepeatMode })}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="hourly">Every hour</SelectItem>
          <SelectItem value="daily">Every day</SelectItem>
          <SelectItem value="weekdays">Every weekday</SelectItem>
          <SelectItem value="weekly">Weekly on specific days</SelectItem>
          <SelectItem value="monthly">Monthly</SelectItem>
          <SelectItem value="custom">Custom cron</SelectItem>
        </SelectContent>
      </Select>

      {form.repeat === "hourly" && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Every</span>
          <Select value={String(form.intervalMinutes)} onValueChange={(v) => set({ intervalMinutes: Number(v) })}>
            <SelectTrigger className="flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="15">15 minutes</SelectItem>
              <SelectItem value="30">30 minutes</SelectItem>
              <SelectItem value="0">hour</SelectItem>
            </SelectContent>
          </Select>
          {form.intervalMinutes === 0 && (
            <>
              <span className="text-sm text-muted-foreground">at</span>
              <Select value={String(form.minute)} onValueChange={(v) => set({ minute: Number(v) })}>
                <SelectTrigger className="w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MINUTES.map((m) => (
                    <SelectItem key={m} value={String(m)}>:{String(m).padStart(2, "0")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
        </div>
      )}

      {form.repeat !== "hourly" && form.repeat !== "custom" && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">at</span>
          <Select value={String(form.hour)} onValueChange={(v) => set({ hour: Number(v) })}>
            <SelectTrigger className="flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 24 }, (_, i) => (
                <SelectItem key={i} value={String(i)}>{i % 12 || 12} {i >= 12 ? "PM" : "AM"}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">:</span>
          <Select value={String(form.minute)} onValueChange={(v) => set({ minute: Number(v) })}>
            <SelectTrigger className="w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MINUTES.map((m) => (
                <SelectItem key={m} value={String(m)}>{String(m).padStart(2, "0")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {form.repeat === "weekly" && (
        <div className="flex items-center gap-1.5">
          {DAYS_OF_WEEK.map((day, i) => (
            <Button
              key={day}
              type="button"
              variant={form.days.includes(i) ? "default" : "outline"}
              size="icon"
              className="h-8 w-8 rounded-full text-2xs font-medium"
              onClick={() =>
                set({ days: form.days.includes(i) ? form.days.filter((d) => d !== i) : [...form.days, i].sort() })
              }
            >
              {day.charAt(0)}
            </Button>
          ))}
        </div>
      )}

      {form.repeat === "monthly" && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">on day</span>
          <Select value={String(form.monthDay)} onValueChange={(v) => set({ monthDay: Number(v) })}>
            <SelectTrigger className="flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 28 }, (_, i) => (
                <SelectItem key={i + 1} value={String(i + 1)}>{ordinal(i + 1)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {form.repeat === "custom" && (
        <div>
          <Input
            value={form.customCron}
            onChange={(e) => set({ customCron: e.target.value })}
            placeholder="0 9 * * 1-5"
            className="font-mono text-sm"
          />
          <p className="text-2xs text-muted-foreground mt-1">minute hour day-of-month month day-of-week</p>
        </div>
      )}
    </div>
  );
}

function OnceFields({ date, time, onChange }: { date: Date | undefined; time: string; onChange: (next: { date?: Date; time?: string }) => void }) {
  const [hours, minutes] = time.split(":");
  return (
    <div className="flex items-center gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className={cn("flex-1 justify-start text-left font-normal", !date && "text-muted-foreground")}
          >
            <CalendarIcon className="h-4 w-4 mr-2" />
            {date ? format(date, "MMM d, yyyy") : "Pick a date"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={date}
            onSelect={(d) => onChange({ date: d ?? undefined })}
            disabled={(d) => d < new Date(new Date().setHours(0, 0, 0, 0))}
          />
        </PopoverContent>
      </Popover>
      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
      <Select value={hours} onValueChange={(v) => onChange({ time: `${v}:${minutes || "00"}` })}>
        <SelectTrigger className="w-[76px] h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Array.from({ length: 24 }, (_, i) => (
            <SelectItem key={i} value={String(i).padStart(2, "0")} className="text-xs">
              {i % 12 || 12} {i >= 12 ? "PM" : "AM"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={minutes || "00"} onValueChange={(v) => onChange({ time: `${hours || "09"}:${v}` })}>
        <SelectTrigger className="w-[64px] h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MINUTES.map((m) => (
            <SelectItem key={m} value={String(m).padStart(2, "0")} className="text-xs">
              {String(m).padStart(2, "0")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function TriggerEditor({
  members,
  onChange,
}: {
  members: TriggerMemberForm[];
  onChange: (next: TriggerMemberForm[]) => void;
}) {
  const update = (index: number, next: TriggerMemberForm) =>
    onChange(members.map((m, i) => (i === index ? next : m)));
  const remove = (index: number) => onChange(members.filter((_, i) => i !== index));

  return (
    <div className="space-y-3">
      {members.map((member, index) => (
        <div key={index} className="rounded-lg border bg-muted/30 p-3 space-y-2">
          <div className="flex items-center gap-2">
            {index > 0 && <span className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide">or</span>}
            <Select
              value={member.kind}
              onValueChange={(v) => update(index, defaultMember(v as TriggerMemberForm["kind"]))}
            >
              <SelectTrigger className="flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="event">When something happens</SelectItem>
                <SelectItem value="cron">On a schedule</SelectItem>
                <SelectItem value="once">Once, at a time</SelectItem>
              </SelectContent>
            </Select>
            {members.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Remove trigger"
                className="h-8 w-8 text-muted-foreground"
                onClick={() => remove(index)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>

          {member.kind === "event" && (
            <Select value={member.event} onValueChange={(v) => update(index, { kind: "event", event: v as AutomationEventName })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AUTOMATION_EVENT_NAMES.map((name) => (
                  <SelectItem key={name} value={name}>{AUTOMATION_EVENT_LABELS[name]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {member.kind === "cron" && (
            <ScheduleFields form={member.form} onChange={(form) => update(index, { kind: "cron", form })} />
          )}
          {member.kind === "once" && (
            <OnceFields
              date={member.date}
              time={member.time}
              onChange={(next) => update(index, { ...member, ...next })}
            />
          )}
        </div>
      ))}

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {members.map(describeMember).map((text, i) => (i === 0 ? text : text.charAt(0).toLowerCase() + text.slice(1))).join(" or ")}
        </p>
        {members.length < MAX_MEMBERS && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground shrink-0"
            onClick={() => onChange([...members, defaultMember(members.some((m) => m.kind === "event") ? "cron" : "event")])}
          >
            <Plus className="h-3.5 w-3.5" />
            Add another trigger
          </Button>
        )}
      </div>
    </div>
  );
}
