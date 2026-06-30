import { describe, it, expect } from "vitest";
import { shouldAutoExitForWork, WORKDAY_DAYTIME_STATES } from "./scene-commands";
import { beijingWorkStartMs } from "./scene-auto-exit";

// 用北京时间构造一个 Date（北京 = UTC+8）。
function beijing(dateKey: string, time: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh - 8, mm, 0));
}

describe("shouldAutoExitForWork", () => {
  const todayDateKey = "2026-07-01";
  const workStartMs = beijingWorkStartMs(beijing(todayDateKey, "07:40"));
  const overnightOpened = beijing(todayDateKey, "00:30").getTime();

  it("工作日上班时段 + 过夜场景 → 退出", () => {
    expect(shouldAutoExitForWork({
      dayKind: "weekday", stateId: "working_morning", sceneOn: true,
      openedAtMs: overnightOpened, workStartMs, lastExitDateKey: undefined, todayDateKey,
    })).toBe(true);
  });

  it("出门通勤(07:40)即触发", () => {
    expect(shouldAutoExitForWork({
      dayKind: "weekday", stateId: "commuting_to_work", sceneOn: true,
      openedAtMs: overnightOpened, workStartMs, lastExitDateKey: undefined, todayDateKey,
    })).toBe(true);
    expect(WORKDAY_DAYTIME_STATES.has("commuting_to_work")).toBe(true);
  });

  it("周末不退", () => {
    expect(shouldAutoExitForWork({
      dayKind: "saturday", stateId: "working_morning", sceneOn: true,
      openedAtMs: overnightOpened, workStartMs, lastExitDateKey: undefined, todayDateKey,
    })).toBe(false);
    expect(shouldAutoExitForWork({
      dayKind: "sunday", stateId: "sunday_work_prep", sceneOn: true,
      openedAtMs: overnightOpened, workStartMs, lastExitDateKey: undefined, todayDateKey,
    })).toBe(false);
  });

  it("非白天上班时段（晚上/睡觉）不退", () => {
    for (const stateId of ["evening_home", "night_reading", "sleeping", "commuting_home", "dinner_at_home"]) {
      expect(shouldAutoExitForWork({
        dayKind: "weekday", stateId, sceneOn: true,
        openedAtMs: overnightOpened, workStartMs, lastExitDateKey: undefined, todayDateKey,
      })).toBe(false);
    }
  });

  it("没开场景不退", () => {
    expect(shouldAutoExitForWork({
      dayKind: "weekday", stateId: "working_morning", sceneOn: false,
      openedAtMs: overnightOpened, workStartMs, lastExitDateKey: undefined, todayDateKey,
    })).toBe(false);
  });

  it("今天已自动退过 → 不重复退（尊重白天手动重开）", () => {
    expect(shouldAutoExitForWork({
      dayKind: "weekday", stateId: "working_afternoon", sceneOn: true,
      openedAtMs: overnightOpened, workStartMs, lastExitDateKey: todayDateKey, todayDateKey,
    })).toBe(false);
  });

  it("当天上班点之后才开的（白天主动玩）→ 不退", () => {
    const openedAfterWork = beijing(todayDateKey, "09:30").getTime();
    expect(shouldAutoExitForWork({
      dayKind: "weekday", stateId: "working_morning", sceneOn: true,
      openedAtMs: openedAfterWork, workStartMs, lastExitDateKey: undefined, todayDateKey,
    })).toBe(false);
  });

  it("无开启时间记录（如重启残留）→ 视为过夜、该退", () => {
    expect(shouldAutoExitForWork({
      dayKind: "weekday", stateId: "working_morning", sceneOn: true,
      openedAtMs: undefined, workStartMs, lastExitDateKey: undefined, todayDateKey,
    })).toBe(true);
  });

  it("beijingWorkStartMs 对齐当天北京 07:40", () => {
    const now = beijing(todayDateKey, "10:00");
    expect(beijingWorkStartMs(now)).toBe(beijing(todayDateKey, "07:40").getTime());
  });
});
