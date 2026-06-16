import { describe, expect, it } from "vitest";
import {
  buildInnerStateOverlay,
  deriveEmotionalLabel,
  ensureDayContext,
  evolveInnerState,
  getEffectiveInnerState,
  type PersonaInnerState,
} from "./persona-inner-state";
import { getPersonaScheduleState } from "./life-schedule";

// 固定到工作日中午（北京时间），让作息槽确定，便于断言。
const NOW = new Date("2026-06-17T12:00:00+08:00");

function withStored(state: Partial<PersonaInnerState>): unknown {
  return { personaRuntime: { runtimeInnerState: state } };
}

describe("persona inner state", () => {
  it("falls back to a calm baseline when nothing is stored", () => {
    const state = getEffectiveInnerState({}, 7, NOW);
    expect(state.intensity).toBe(0);
    expect(state.mood).toBe("平静");
    expect(state.dayContext?.dateKey).toBeTruthy();
  });

  it("decays intensity by half-life over elapsed time", () => {
    const eightHoursAgo = new Date(NOW.getTime() - 8 * 3_600_000).toISOString();
    const state = getEffectiveInnerState(
      withStored({ mood: "烦躁", valence: -0.5, energy: 0.8, intensity: 0.8, cause: "被冷落", updatedAt: eightHoursAgo }),
      7,
      NOW,
    );
    // 半衰期 4h，过去 8h → 强度约 0.8 * 0.25 = 0.2
    expect(state.intensity).toBeGreaterThan(0.15);
    expect(state.intensity).toBeLessThan(0.25);
  });

  it("relaxes mood back to baseline once intensity decays below threshold", () => {
    const twelveHoursAgo = new Date(NOW.getTime() - 12 * 3_600_000).toISOString();
    const state = getEffectiveInnerState(
      withStored({ mood: "烦躁", valence: -0.6, energy: 0.7, intensity: 0.3, cause: "被冷落", updatedAt: twelveHoursAgo }),
      7,
      NOW,
    );
    expect(state.intensity).toBeLessThan(0.15);
    expect(state.mood).toBe("平静");
    expect(state.cause).toBe("");
  });

  it("resets to baseline when the stored state is stale (> reset window)", () => {
    const longAgo = new Date(NOW.getTime() - 20 * 3_600_000).toISOString();
    const state = getEffectiveInnerState(
      withStored({ mood: "激动", valence: 0.9, energy: 0.9, intensity: 0.95, cause: "x", updatedAt: longAgo }),
      7,
      NOW,
    );
    expect(state.intensity).toBe(0);
    expect(state.mood).toBe("平静");
  });

  it("produces a stable day context for the same persona and day", () => {
    const schedule = getPersonaScheduleState(NOW);
    const a = ensureDayContext(null, 7, schedule);
    const b = ensureDayContext(null, 7, schedule);
    expect(a.flavor).toBe(b.flavor);
    expect(a.dateKey).toBe(schedule.dateKey);
    // 已有且同一天的 dayContext 直接复用
    const reused = ensureDayContext(a, 7, schedule);
    expect(reused).toBe(a);
  });

  it("evolves intensity and mood after a turn", () => {
    const effective = getEffectiveInnerState({}, 7, NOW);
    const next = evolveInnerState(
      effective,
      { reflectionMood: "心里发暖", reflectionInnerReaction: "对方主动表白，我有点动容", intent: "affection_expression" },
      NOW,
    );
    expect(next.mood).toBe("心里发暖");
    expect(next.intensity).toBeGreaterThan(effective.intensity);
    expect(next.valence).toBeGreaterThan(effective.valence);
    expect(next.cause).toContain("表白");
  });

  it("derives backward-compatible emotional labels", () => {
    const base = getEffectiveInnerState({}, 7, NOW);
    expect(deriveEmotionalLabel({ ...base, mood: "想念加重", cause: "想你" })).toBe("nostalgic");
    expect(deriveEmotionalLabel({ ...base, valence: -0.5 })).toBe("melancholy");
    expect(deriveEmotionalLabel({ ...base, valence: 0.6, energy: 0.7 })).toBe("happy");
    expect(deriveEmotionalLabel({ ...base, valence: 0.1, energy: 0.7, mood: "平静" })).toBe("warm");
  });

  it("renders a prompt overlay that hides internal fields", () => {
    const overlay = buildInnerStateOverlay(getEffectiveInnerState({}, 7, NOW));
    expect(overlay).toContain("【当前内心状态】");
    expect(overlay).toContain("不要直接说破");
  });
});
