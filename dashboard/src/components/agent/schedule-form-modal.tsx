"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent } from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createSchedule } from "@/lib/api";
import {
  buildCron,
  describeSchedule,
  ordinal,
  DAYS_OF_WEEK,
  type RepeatMode,
} from "@/lib/cron";
import {
  CalendarDots,
  Calendar as CalendarIcon,
  Clock,
  SpinnerGap,
  ArrowsClockwise,
  X,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

// New-schedule form modal. Stays mounted while closed (renders null) so form
// state survives close/reopen; fields only reset after a successful create.
export function ScheduleFormModal({
  agentId,
  open,
  onClose,
  onCreated,
}: {
  agentId: string;
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [formRepeat, setFormRepeat] = useState<RepeatMode>("daily");
  const [formHour, setFormHour] = useState(9);
  const [formMinute, setFormMinute] = useState(0);
  const [formDays, setFormDays] = useState<number[]>([1]);
  const [formMonthDay, setFormMonthDay] = useState(1);
  const [formIntervalMinutes, setFormIntervalMinutes] = useState(30);
  const [formCustomCron, setFormCustomCron] = useState("");
  const [formRunAtDate, setFormRunAtDate] = useState<Date | undefined>();
  const [formRunAtTime, setFormRunAtTime] = useState("09:00");
  const [formMessage, setFormMessage] = useState("");
  const [formLabel, setFormLabel] = useState("");
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!formMessage.trim()) return;

    const isOnce = formRepeat === "once";
    const cron = isOnce ? undefined : buildCron({
      repeat: formRepeat,
      hour: formHour,
      minute: formMinute,
      days: formDays,
      monthDay: formMonthDay,
      customCron: formCustomCron,
      intervalMinutes: formIntervalMinutes,
    });
    let runAt: string | undefined;
    if (isOnce && formRunAtDate) {
      const [hours, minutes] = (formRunAtTime || "09:00").split(":").map(Number);
      const d = new Date(formRunAtDate);
      d.setHours(hours, minutes, 0, 0);
      runAt = d.toISOString();
    }

    if (!isOnce && (!cron || !cron.trim())) return;
    if (isOnce && !runAt) return;

    setFormSaving(true);
    setFormError(null);
    try {
      await createSchedule({
        cron: cron || undefined,
        runAt,
        agentId,
        message: formMessage,
        label: formLabel || undefined,
      });
      onClose();
      setFormRepeat("daily");
      setFormHour(9);
      setFormMinute(0);
      setFormDays([1]);
      setFormMonthDay(1);
      setFormIntervalMinutes(30);
      setFormCustomCron("");
      setFormRunAtDate(undefined);
      setFormRunAtTime("09:00");
      setFormMessage("");
      setFormLabel("");
      onCreated();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setFormSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <Card className="w-full max-w-lg shadow-lg">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <div className="text-sm font-semibold">New Schedule</div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <CardContent className="p-5 space-y-5">
          <Input
            value={formLabel}
            onChange={(e) => setFormLabel(e.target.value)}
            placeholder="Add title"
            className="text-base font-medium border-0 border-b rounded-none px-0 focus-visible:ring-0 focus-visible:border-primary"
          />

          <Textarea
            value={formMessage}
            onChange={(e) => setFormMessage(e.target.value)}
            placeholder="What should the agent do?"
            rows={2}
            className="text-sm"
          />

          {/* Repeat */}
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <ArrowsClockwise className="h-4 w-4 text-muted-foreground shrink-0" />
              <Select value={formRepeat} onValueChange={(v) => setFormRepeat(v as RepeatMode)}>
                <SelectTrigger className="flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="once">Does not repeat</SelectItem>
                  <SelectItem value="hourly">Every hour</SelectItem>
                  <SelectItem value="daily">Every day</SelectItem>
                  <SelectItem value="weekdays">Every weekday (Mon-Fri)</SelectItem>
                  <SelectItem value="weekly">Weekly on specific days</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="custom">Custom cron</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Date + time picker for one-time events */}
            {formRepeat === "once" && (
              <div className="flex items-center gap-3">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-[180px] shrink-0 justify-start text-left font-normal",
                        !formRunAtDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="h-4 w-4 mr-2" />
                      {formRunAtDate
                        ? format(formRunAtDate, "MMM d, yyyy")
                        : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={formRunAtDate}
                      onSelect={setFormRunAtDate}
                      disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                    />
                  </PopoverContent>
                </Popover>
                <div className="flex items-center gap-1.5 text-xs">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  <Select
                    value={formRunAtTime.split(":")[0]}
                    onValueChange={(v) => {
                      const mins = formRunAtTime.split(":")[1] || "00";
                      setFormRunAtTime(`${v}:${mins}`);
                    }}
                  >
                    <SelectTrigger className="w-[72px] h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 24 }, (_, i) => {
                        const h12 = i % 12 || 12;
                        const ampm = i >= 12 ? "PM" : "AM";
                        return (
                          <SelectItem key={i} value={String(i).padStart(2, "0")} className="text-xs">
                            {h12} {ampm}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  <span className="text-xs text-muted-foreground">:</span>
                  <Select
                    value={formRunAtTime.split(":")[1] || "00"}
                    onValueChange={(v) => {
                      const hrs = formRunAtTime.split(":")[0] || "09";
                      setFormRunAtTime(`${hrs}:${v}`);
                    }}
                  >
                    <SelectTrigger className="w-[60px] h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
                        <SelectItem key={m} value={String(m).padStart(2, "0")} className="text-xs">
                          {String(m).padStart(2, "0")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {/* Time picker for recurring */}
            {formRepeat !== "custom" && formRepeat !== "once" && (
              <div className="flex items-center gap-3">
                <CalendarDots className="h-4 w-4 text-muted-foreground shrink-0" />
                {formRepeat === "hourly" ? (
                  <div className="flex items-center gap-2 flex-1">
                    <span className="text-sm text-muted-foreground">Every</span>
                    <Select
                      value={String(formIntervalMinutes)}
                      onValueChange={(v) => setFormIntervalMinutes(Number(v))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="15">15 minutes</SelectItem>
                        <SelectItem value="30">30 minutes</SelectItem>
                        <SelectItem value="0">hour (at :{String(formMinute).padStart(2, "0")})</SelectItem>
                      </SelectContent>
                    </Select>
                    {formIntervalMinutes === 0 && (
                      <>
                        <span className="text-sm text-muted-foreground">at</span>
                        <Select
                          value={String(formMinute)}
                          onValueChange={(v) => setFormMinute(Number(v))}
                        >
                          <SelectTrigger className="w-20">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map(m => (
                              <SelectItem key={m} value={String(m)}>:{String(m).padStart(2, "0")}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 flex-1">
                    <span className="text-sm text-muted-foreground">at</span>
                    <Select
                      value={String(formHour)}
                      onValueChange={(v) => setFormHour(Number(v))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 24 }, (_, i) => {
                          const h12 = i % 12 || 12;
                          const ampm = i >= 12 ? "PM" : "AM";
                          return <SelectItem key={i} value={String(i)}>{h12} {ampm}</SelectItem>;
                        })}
                      </SelectContent>
                    </Select>
                    <span className="text-sm text-muted-foreground">:</span>
                    <Select
                      value={String(formMinute)}
                      onValueChange={(v) => setFormMinute(Number(v))}
                    >
                      <SelectTrigger className="w-20">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map(m => (
                          <SelectItem key={m} value={String(m)}>{String(m).padStart(2, "0")}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )}

            {/* Day-of-week toggles for weekly */}
            {formRepeat === "weekly" && (
              <div className="flex items-center gap-1.5 pl-7">
                {DAYS_OF_WEEK.map((day, i) => (
                  <Button
                    key={day}
                    type="button"
                    variant={formDays.includes(i) ? "default" : "outline"}
                    size="icon"
                    className="h-8 w-8 rounded-full text-2xs font-medium"
                    onClick={() =>
                      setFormDays(prev =>
                        prev.includes(i) ? prev.filter(d => d !== i) : [...prev, i].sort()
                      )
                    }
                  >
                    {day.charAt(0)}
                  </Button>
                ))}
              </div>
            )}

            {/* Day of month for monthly */}
            {formRepeat === "monthly" && (
              <div className="flex items-center gap-2 pl-7">
                <span className="text-sm text-muted-foreground">on day</span>
                <Select
                  value={String(formMonthDay)}
                  onValueChange={(v) => setFormMonthDay(Number(v))}
                >
                  <SelectTrigger>
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

            {/* Custom cron input */}
            {formRepeat === "custom" && (
              <div className="pl-7">
                <Input
                  value={formCustomCron}
                  onChange={(e) => setFormCustomCron(e.target.value)}
                  placeholder="0 9 * * 1-5"
                  className="font-mono text-sm"
                  autoFocus
                />
                <p className="text-2xs text-muted-foreground mt-1">
                  minute hour day-of-month month day-of-week
                </p>
              </div>
            )}
          </div>

          {/* Summary */}
          <div className="rounded-md bg-muted/50 px-3 py-2">
            <p className="text-xs text-muted-foreground">
              {describeSchedule({
                repeat: formRepeat,
                hour: formHour,
                minute: formMinute,
                days: formDays,
                monthDay: formMonthDay,
                intervalMinutes: formIntervalMinutes,
                runAtDate: formRunAtDate,
                runAtTime: formRunAtTime,
              })}
            </p>
          </div>

          {formError && (
            <p className="text-2xs text-destructive">{formError}</p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={formSaving || !formMessage.trim() || (formRepeat === "custom" && !formCustomCron.trim()) || (formRepeat === "once" && !formRunAtDate)}
            >
              {formSaving ? (
                <SpinnerGap className="h-3.5 w-3.5 animate-spin" />
              ) : (
                "Save"
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
