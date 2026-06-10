import { describe, expect, it } from "vitest";
import { buildProactiveRuntimePlan } from "./proactive-runtime";

describe("proactive runtime planning", () => {
  it("builds proactive turn planning from the target social platform", () => {
    const plan = buildProactiveRuntimePlan({
      target: { platform: "qq", channel: "qq" },
      inputText: "定时主动消息 21:00 -> 21:06",
      now: new Date(2026, 4, 18, 20, 0),
    });

    expect(plan.platform).toBe("qq");
    expect(plan.channel).toBe("qq");
    expect(plan.outputPreference).toMatchObject({
      allowText: true,
      allowVoice: true,
      allowStickers: true,
      allowProactive: true,
    });
    expect(plan.turnPlan).toMatchObject({
      platform: "qq",
      mode: "proactive",
      replyLength: "short",
      outputMode: "text",
    });
    expect(plan.instruction).toContain("入口：qq");
    expect(plan.instruction).toContain("本轮是主动消息");
  });

  it("falls back to the web runtime contract when there is no external target", () => {
    const plan = buildProactiveRuntimePlan({
      target: { platform: null, channel: "web" },
      inputText: "没有绑定时的主动消息",
      now: new Date(2026, 4, 18, 20, 0),
    });

    expect(plan.platform).toBe("web");
    expect(plan.channel).toBe("web");
    expect(plan.turnPlan.outputMode).toBe("silent");
  });
});
