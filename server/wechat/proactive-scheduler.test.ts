import { describe, expect, it } from "vitest";
import {
  ensureRandomizedSchedule,
  getDueScheduledSlots,
  PROACTIVE_RANDOM_WINDOW_MINUTES,
} from "./proactive-scheduler";

function localDate(year: number, month: number, day: number, hour: number, minute: number) {
  return new Date(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+08:00`);
}

describe("proactive scheduled message jitter", () => {
  it("creates a stable per-day randomized slot within plus/minus ten minutes", () => {
    const now = localDate(2026, 5, 17, 8, 0);
    const schedule = ensureRandomizedSchedule(undefined, ["12:00"], now, () => 0);
    const slot = schedule.days["2026-05-17"]["12:00"];

    expect(schedule.windowMinutes).toBe(PROACTIVE_RANDOM_WINDOW_MINUTES);
    expect(slot.baseDate).toBe("2026-05-17");
    expect(slot.baseTime).toBe("12:00");
    expect(slot.actualDate).toBe("2026-05-17");
    expect(slot.actualTime).toBe("11:50");
    expect(slot.offsetMinutes).toBe(-10);

    const stable = ensureRandomizedSchedule(schedule, ["12:00"], now, () => 0.999);
    expect(stable.days["2026-05-17"]["12:00"]).toEqual(slot);
  });

  it("uses the randomized actual time instead of the configured base time", () => {
    const schedule = ensureRandomizedSchedule(undefined, ["12:00"], localDate(2026, 5, 17, 8, 0), () => 0);

    expect(getDueScheduledSlots(schedule, ["12:00"], {}, localDate(2026, 5, 17, 11, 49))).toHaveLength(0);
    expect(getDueScheduledSlots(schedule, ["12:00"], {}, localDate(2026, 5, 17, 11, 50))).toHaveLength(1);
    expect(getDueScheduledSlots(schedule, ["12:00"], { "12:00": "2026-05-17" }, localDate(2026, 5, 17, 11, 50))).toHaveLength(0);
  });

  it("keeps cross-midnight slots tied to their original configured date", () => {
    const schedule = ensureRandomizedSchedule(undefined, ["23:59"], localDate(2026, 5, 17, 22, 0), () => 0.999);
    const slot = schedule.days["2026-05-17"]["23:59"];

    expect(slot.actualDate).toBe("2026-05-18");
    expect(slot.actualTime).toBe("00:09");
    expect(slot.offsetMinutes).toBe(10);

    const due = getDueScheduledSlots(schedule, ["23:59"], {}, localDate(2026, 5, 18, 0, 9));
    expect(due).toEqual([slot]);
    expect(getDueScheduledSlots(schedule, ["23:59"], { "23:59": "2026-05-17" }, localDate(2026, 5, 18, 0, 9))).toHaveLength(0);
  });

  it("uses Beijing date and time for due checks when server timezone differs", () => {
    const now = new Date("2026-06-08T18:03:00.000Z");
    const schedule = ensureRandomizedSchedule(undefined, ["02:00"], now, () => 0.5);
    const slot = schedule.days["2026-06-09"]["02:00"];

    expect(slot).toMatchObject({
      baseDate: "2026-06-09",
      baseTime: "02:00",
      actualDate: "2026-06-09",
      actualTime: "02:00",
    });
    expect(getDueScheduledSlots(schedule, ["02:00"], {}, now)).toEqual([slot]);
  });
});
