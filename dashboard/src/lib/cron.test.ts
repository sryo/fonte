import { describe, it, expect } from "vitest";
import { parseCronToForm, scheduleFormToCron, DEFAULT_SCHEDULE_FORM } from "./cron";
import { formatRunTime } from "./format";

describe("parseCronToForm", () => {
  it("round-trips the shapes the editor produces", () => {
    for (const cron of ["0 9 * * *", "30 8 * * 1-5", "15 14 * * 1,3", "0 0 1 * *", "*/15 * * * *", "32 * * * *"]) {
      expect(scheduleFormToCron(parseCronToForm(cron))).toBe(cron);
    }
  });

  it("keeps anything else as custom", () => {
    const form = parseCronToForm("0 9 * 6 *");
    expect(form.repeat).toBe("custom");
    expect(form.customCron).toBe("0 9 * 6 *");
    expect(parseCronToForm("nonsense").repeat).toBe("custom");
  });

  it("fills the untouched fields with defaults", () => {
    expect(parseCronToForm("0 9 * * *")).toEqual({ ...DEFAULT_SCHEDULE_FORM, repeat: "daily", hour: 9, minute: 0 });
  });
});

describe("formatRunTime", () => {
  const now = new Date(2026, 8, 1, 15, 0, 0).getTime();
  it("uses relative words close to now and clock times further out", () => {
    expect(formatRunTime(now - 10_000, now)).toBe("Just now");
    expect(formatRunTime(now - 12 * 60_000, now)).toBe("12 min ago");
    expect(formatRunTime(now - 3 * 3_600_000, now)).toBe("Today at 12:00 PM");
    expect(formatRunTime(now - 26 * 3_600_000, now)).toBe("Yesterday at 1:00 PM");
    expect(formatRunTime(now - 3 * 86_400_000, now)).toBe("Last Saturday at 3:00 PM");
    expect(formatRunTime(now + 2 * 86_400_000, now)).toBe("Thursday at 3:00 PM");
    expect(formatRunTime(now - 20 * 86_400_000, now)).toBe("Aug 12 at 3:00 PM");
    expect(formatRunTime(now + 5 * 60_000, now)).toBe("In 5 min");
  });
});
