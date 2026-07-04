// Pure cron helpers for the schedule UI: computing upcoming occurrences,
// building expressions from form state, and human-readable summaries.

export function cronNextOccurrences(cron: string, count: number): Date[] {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return [];

  const [minF, hourF, domF, monF, dowF] = fields;
  const results: Date[] = [];
  const now = new Date();
  const cursor = new Date(now);
  cursor.setSeconds(0, 0);

  function matches(val: number, field: string): boolean {
    if (field === "*") return true;
    for (const part of field.split(",")) {
      if (part.includes("/")) {
        const [base, step] = part.split("/");
        const stepN = parseInt(step);
        const baseN = base === "*" ? 0 : parseInt(base);
        if (stepN > 0 && (val - baseN) % stepN === 0 && val >= baseN) return true;
      } else if (part.includes("-")) {
        const [lo, hi] = part.split("-").map(Number);
        if (val >= lo && val <= hi) return true;
      } else {
        if (parseInt(part) === val) return true;
      }
    }
    return false;
  }

  for (let i = 0; i < 60 * 24 * 90 && results.length < count; i++) {
    cursor.setMinutes(cursor.getMinutes() + 1);
    const min = cursor.getMinutes();
    const hour = cursor.getHours();
    const dom = cursor.getDate();
    const mon = cursor.getMonth() + 1;
    const dow = cursor.getDay();

    if (
      matches(min, minF) &&
      matches(hour, hourF) &&
      matches(dom, domF) &&
      matches(mon, monF) &&
      (matches(dow, dowF) || matches(dow === 0 ? 7 : dow, dowF))
    ) {
      results.push(new Date(cursor));
    }
  }
  return results;
}

export type RepeatMode = "once" | "daily" | "weekdays" | "weekly" | "monthly" | "hourly" | "custom";
export const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function buildCron(opts: {
  repeat: RepeatMode;
  hour: number;
  minute: number;
  days: number[];
  monthDay: number;
  customCron: string;
  intervalMinutes: number;
}): string {
  switch (opts.repeat) {
    case "once":
      return "";
    case "hourly":
      return opts.intervalMinutes > 0
        ? `*/${opts.intervalMinutes} * * * *`
        : `${opts.minute} * * * *`;
    case "daily":
      return `${opts.minute} ${opts.hour} * * *`;
    case "weekdays":
      return `${opts.minute} ${opts.hour} * * 1-5`;
    case "weekly":
      if (opts.days.length === 0) return `${opts.minute} ${opts.hour} * * *`;
      return `${opts.minute} ${opts.hour} * * ${opts.days.join(",")}`;
    case "monthly":
      return `${opts.minute} ${opts.hour} ${opts.monthDay} * *`;
    case "custom":
      return opts.customCron;
  }
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function describeSchedule(opts: {
  repeat: RepeatMode;
  hour: number;
  minute: number;
  days: number[];
  monthDay: number;
  intervalMinutes: number;
  runAtDate: Date | undefined;
  runAtTime: string;
}): string {
  const timeStr = `${opts.hour % 12 || 12}:${String(opts.minute).padStart(2, "0")} ${opts.hour >= 12 ? "PM" : "AM"}`;
  switch (opts.repeat) {
    case "once": {
      if (!opts.runAtDate) return "Pick a date and time";
      const [hours, minutes] = (opts.runAtTime || "09:00").split(":").map(Number);
      const d = new Date(opts.runAtDate);
      d.setHours(hours, minutes, 0, 0);
      return `Once on ${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })} at ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
    }
    case "hourly":
      return opts.intervalMinutes > 0
        ? `Every ${opts.intervalMinutes} minutes`
        : `Every hour at :${String(opts.minute).padStart(2, "0")}`;
    case "daily":
      return `Every day at ${timeStr}`;
    case "weekdays":
      return `Weekdays (Mon-Fri) at ${timeStr}`;
    case "weekly": {
      if (opts.days.length === 0) return `Every day at ${timeStr}`;
      const names = opts.days.map(d => DAYS_OF_WEEK[d]);
      return `Every ${names.join(", ")} at ${timeStr}`;
    }
    case "monthly":
      return `${ordinal(opts.monthDay)} of every month at ${timeStr}`;
    case "custom":
      return "Custom cron expression";
  }
}
