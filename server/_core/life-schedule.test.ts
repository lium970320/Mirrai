import { describe, expect, it } from "vitest";
import {
  applyIncomingLifeState,
  buildEffectiveLifeScheduleOverlay,
  buildLifeScheduleOverlay,
  getActiveRuntimeLifeState,
  getPersonaScheduleState,
  shouldSuppressImmediateReplyBySchedule,
} from "./life-schedule";

function beijingDate(date: string, time: string): Date {
  return new Date(`${date}T${time}:00+08:00`);
}

describe("life schedule", () => {
  it("maps weekday morning to research institute work", () => {
    const state = getPersonaScheduleState(beijingDate("2026-05-14", "09:10"));

    expect(state.status).toBe("working");
    expect(state.stateId).toBe("working_morning");
    expect(state.availability).toBe("brief");
    expect(state.label).toContain("研究所");
  });

  it("suppresses non-urgent social replies while asleep", () => {
    const result = shouldSuppressImmediateReplyBySchedule(
      "叔，你睡了吗",
      beijingDate("2026-05-14", "00:30"),
    );

    expect(result.suppress).toBe(true);
    expect(result.reason).toBe("persona_asleep");
  });

  it("allows urgent or wake messages while asleep", () => {
    const result = shouldSuppressImmediateReplyBySchedule(
      "醒醒，我有点难受",
      beijingDate("2026-05-14", "00:30"),
    );

    expect(result.suppress).toBe(false);
  });

  it("builds an overlay that preserves the Wuhan-Nanjing long-distance setup", () => {
    const overlay = buildLifeScheduleOverlay(beijingDate("2026-05-14", "18:00"));

    expect(overlay).toContain("下班回家路上");
    expect(overlay).toContain("当前北京时间：2026-05-14 18:00（晚上");
    expect(overlay).toContain("基础状态ID：commuting_home");
    expect(overlay).toContain("回复可用性：可回复，但应短句、克制");
    expect(overlay).toContain("武汉纺织大学");
    expect(overlay).toContain("南京研究所");
  });

  it("drops the long-distance behavior rule and adds copresence exemptions in immersive mode", () => {
    const daily = buildEffectiveLifeScheduleOverlay({}, beijingDate("2026-05-14", "18:00"), false);
    const scene = buildEffectiveLifeScheduleOverlay({}, beijingDate("2026-05-14", "18:00"), true);

    // 日常模式（默认）：保留异地行为禁令
    expect(daily).toContain("不要默认同屋、同城、马上见面");
    expect(daily).not.toContain("时空豁免");

    // 场景模式：异地行为禁令被换成时空豁免，并追加实时定位豁免
    expect(scene).not.toContain("不要默认同屋、同城、马上见面");
    expect(scene).toContain("场景模式·时空豁免");
    expect(scene).toContain("场景模式·实时定位豁免");
  });

  it("persists a drowsy awake runtime state after a wake message", () => {
    const result = applyIncomingLifeState(
      {},
      "叔，醒醒",
      beijingDate("2026-05-14", "00:30"),
    );

    expect(result.suppress).toBe(false);
    expect(result.changed).toBe(true);
    const runtime = getActiveRuntimeLifeState(result.personaData, beijingDate("2026-05-14", "00:31"));
    expect(runtime?.status).toBe("drowsy_awake");
    expect(runtime?.reason).toBe("wake_message");
    expect(result.personaData.runtimeLifeState).toBeUndefined();
    expect(result.personaData.personaRuntime?.runtimeLifeState?.status).toBe("drowsy_awake");
  });

  it("allows follow-up messages while the drowsy awake state is active", () => {
    const first = applyIncomingLifeState(
      {},
      "醒醒",
      beijingDate("2026-05-14", "00:30"),
    );
    const second = applyIncomingLifeState(
      first.personaData,
      "我还想跟你说句话",
      beijingDate("2026-05-14", "00:35"),
    );

    expect(second.suppress).toBe(false);
    expect(second.changed).toBe(true);
    expect(getActiveRuntimeLifeState(second.personaData, beijingDate("2026-05-14", "00:36"))?.reason).toBe("continued_chat");
  });

  it("expires drowsy awake state and suppresses normal messages again", () => {
    const first = applyIncomingLifeState(
      {},
      "醒醒",
      beijingDate("2026-05-14", "00:30"),
    );
    const later = applyIncomingLifeState(
      first.personaData,
      "叔",
      beijingDate("2026-05-14", "00:55"),
    );

    expect(later.suppress).toBe(true);
    expect(later.reason).toBe("persona_asleep");
  });

  it("mentions drowsy awake state in the effective overlay", () => {
    const first = applyIncomingLifeState(
      {},
      "醒醒",
      beijingDate("2026-05-14", "00:30"),
    );
    const overlay = buildEffectiveLifeScheduleOverlay(first.personaData, beijingDate("2026-05-14", "00:31"));

    expect(overlay).toContain("半睡半醒");
    expect(overlay).toContain("迷迷糊糊");
    expect(overlay).toContain("有效状态ID：drowsy_awake");
    expect(overlay).toContain("覆盖基础状态 sleeping");
  });

  it("uses Beijing time instead of the server local timezone for late-night schedule state", () => {
    const state = getPersonaScheduleState(new Date("2026-06-08T18:03:00.000Z"));
    const overlay = buildLifeScheduleOverlay(new Date("2026-06-08T18:03:00.000Z"));

    expect(state.dateKey).toBe("2026-06-09");
    expect(state.timeKey).toBe("02:03");
    expect(state.dayPart).toBe("凌晨");
    expect(state.stateId).toBe("sleeping");
    expect(overlay).toContain("当前北京时间：2026-06-09 02:03（凌晨");
    expect(overlay).toContain("时间一致性");
  });
});
