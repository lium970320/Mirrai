import { describe, expect, it } from "vitest";
import {
  applyIncomingLifeState,
  buildEffectiveLifeScheduleOverlay,
  buildLifeScheduleOverlay,
  getActiveRuntimeLifeState,
  getPersonaScheduleState,
  shouldSuppressImmediateReplyBySchedule,
} from "./life-schedule";

describe("life schedule", () => {
  it("maps weekday morning to research institute work", () => {
    const state = getPersonaScheduleState(new Date(2026, 4, 14, 9, 10));

    expect(state.status).toBe("working");
    expect(state.stateId).toBe("working_morning");
    expect(state.availability).toBe("brief");
    expect(state.label).toContain("研究所");
  });

  it("suppresses non-urgent social replies while asleep", () => {
    const result = shouldSuppressImmediateReplyBySchedule(
      "叔，你睡了吗",
      new Date(2026, 4, 14, 0, 30),
    );

    expect(result.suppress).toBe(true);
    expect(result.reason).toBe("persona_asleep");
  });

  it("allows urgent or wake messages while asleep", () => {
    const result = shouldSuppressImmediateReplyBySchedule(
      "醒醒，我有点难受",
      new Date(2026, 4, 14, 0, 30),
    );

    expect(result.suppress).toBe(false);
  });

  it("builds an overlay that preserves the Wuhan-Nanjing long-distance setup", () => {
    const overlay = buildLifeScheduleOverlay(new Date(2026, 4, 14, 18, 0));

    expect(overlay).toContain("下班回家路上");
    expect(overlay).toContain("基础状态ID：commuting_home");
    expect(overlay).toContain("回复可用性：可回复，但应短句、克制");
    expect(overlay).toContain("武汉纺织大学");
    expect(overlay).toContain("南京研究所");
  });

  it("persists a drowsy awake runtime state after a wake message", () => {
    const result = applyIncomingLifeState(
      {},
      "叔，醒醒",
      new Date(2026, 4, 14, 0, 30),
    );

    expect(result.suppress).toBe(false);
    expect(result.changed).toBe(true);
    const runtime = getActiveRuntimeLifeState(result.personaData, new Date(2026, 4, 14, 0, 31));
    expect(runtime?.status).toBe("drowsy_awake");
    expect(runtime?.reason).toBe("wake_message");
  });

  it("allows follow-up messages while the drowsy awake state is active", () => {
    const first = applyIncomingLifeState(
      {},
      "醒醒",
      new Date(2026, 4, 14, 0, 30),
    );
    const second = applyIncomingLifeState(
      first.personaData,
      "我还想跟你说句话",
      new Date(2026, 4, 14, 0, 35),
    );

    expect(second.suppress).toBe(false);
    expect(second.changed).toBe(true);
    expect(getActiveRuntimeLifeState(second.personaData, new Date(2026, 4, 14, 0, 36))?.reason).toBe("continued_chat");
  });

  it("expires drowsy awake state and suppresses normal messages again", () => {
    const first = applyIncomingLifeState(
      {},
      "醒醒",
      new Date(2026, 4, 14, 0, 30),
    );
    const later = applyIncomingLifeState(
      first.personaData,
      "叔",
      new Date(2026, 4, 14, 0, 55),
    );

    expect(later.suppress).toBe(true);
    expect(later.reason).toBe("persona_asleep");
  });

  it("mentions drowsy awake state in the effective overlay", () => {
    const first = applyIncomingLifeState(
      {},
      "醒醒",
      new Date(2026, 4, 14, 0, 30),
    );
    const overlay = buildEffectiveLifeScheduleOverlay(first.personaData, new Date(2026, 4, 14, 0, 31));

    expect(overlay).toContain("半睡半醒");
    expect(overlay).toContain("迷迷糊糊");
    expect(overlay).toContain("有效状态ID：drowsy_awake");
    expect(overlay).toContain("覆盖基础状态 sleeping");
  });
});
