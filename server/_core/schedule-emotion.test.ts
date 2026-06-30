import { describe, it, expect } from "vitest";
import { getEffectiveInnerState } from "./persona-inner-state";
import { applyIncomingLifeState } from "./life-schedule";

// 用北京时间构造 Date（北京 = UTC+8）。
function beijing(dateKey: string, time: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh - 8, mm, 0));
}

const WORKDAY = "2026-05-14"; // 已知工作日（周四）

describe("作息驱动情绪底色（A）", () => {
  it("工作日上班时段：默认心情偏「闷」", () => {
    const s = getEffectiveInnerState({}, 1, beijing(WORKDAY, "10:00"));
    expect(s.mood).toContain("闷");
  });

  it("晚间在家：默认心情偏「松」", () => {
    const s = getEffectiveInnerState({}, 1, beijing(WORKDAY, "20:00"));
    expect(s.mood).toContain("松");
  });

  it("上班 valence 明显低于晚间在家（作息把情绪往闷/松两头拉）", () => {
    const work = getEffectiveInnerState({}, 1, beijing(WORKDAY, "10:00"));
    const home = getEffectiveInnerState({}, 1, beijing(WORKDAY, "20:00"));
    expect(work.valence).toBeLessThan(home.valence);
  });

  it("睡眠时段精力基线很低", () => {
    const s = getEffectiveInnerState({}, 1, beijing(WORKDAY, "02:00"));
    expect(s.energy).toBeLessThan(0.4);
  });
});

describe("沉浸态豁免睡眠抑制（E）", () => {
  const sleepNow = beijing(WORKDAY, "02:00"); // 凌晨睡眠时段

  it("普通消息 + 非沉浸 → 睡眠时被抑制", () => {
    expect(applyIncomingLifeState({}, "在干嘛", sleepNow, false).suppress).toBe(true);
  });

  it("普通消息 + 沉浸模式 → 不抑制（凌晨也能进场景）", () => {
    expect(applyIncomingLifeState({}, "在干嘛", sleepNow, true).suppress).toBe(false);
  });

  it("叫醒类消息 → 不抑制（原有行为不变）", () => {
    expect(applyIncomingLifeState({}, "醒醒", sleepNow, false).suppress).toBe(false);
  });

  it("非睡眠时段不受影响", () => {
    expect(applyIncomingLifeState({}, "在干嘛", beijing(WORKDAY, "20:00"), false).suppress).toBe(false);
  });
});
