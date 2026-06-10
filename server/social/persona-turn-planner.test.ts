import { describe, expect, it } from "vitest";
import { buildTurnPlanInstruction, planPersonaTurn } from "./persona-turn-planner";

describe("persona turn planner", () => {
  it("prioritizes source library mode for original-story recall", () => {
    const plan = planPersonaTurn({
      platform: "qq",
      inputText: "你还记得中考那时候的事吗",
      sourceRecallActive: true,
      now: new Date(2026, 4, 18, 10, 0),
    });

    expect(plan.intent).toBe("source_recall");
    expect(plan.memoryMode).toBe("source_library");
    expect(plan.risks).toContain("source_hallucination");

    const instruction = buildTurnPlanInstruction(plan);
    expect(instruction).toContain("原著幻觉风险");
    expect(instruction).toContain("不要向用户解释这些标签");
  });

  it("marks consecutive short messages as a single context-fragmentation risk", () => {
    const plan = planPersonaTurn({
      platform: "web",
      inputText: "没\n我不是那个意思",
      batchMessageCount: 2,
      now: new Date(2026, 4, 18, 20, 0),
    });

    expect(plan.replyLength).toBe("short");
    expect(plan.risks).toContain("context_fragmentation");
  });

  it("allows explicit affection requests to be longer and relationship-grounded", () => {
    const plan = planPersonaTurn({
      platform: "qq",
      inputText: "多说一点你有多爱我，我想听你说内心话",
      now: new Date(2026, 4, 18, 22, 0),
    });

    expect(plan.intent).toBe("affection_expression");
    expect(plan.memoryMode).toBe("relationship_ledger");
    expect(plan.replyLength).toBe("long");

    const instruction = buildTurnPlanInstruction(plan);
    expect(instruction).toContain("不要只说“爱你”“想你”");
    expect(instruction).toContain("不要用“好了”“睡吧”“明天再说”“明天给你发”");
  });

  it("treats 'say more' as an affection follow-up when recent context is romantic", () => {
    const plan = planPersonaTurn({
      platform: "qq",
      inputText: "再多说一点，别这么短",
      recentMessages: [
        { role: "user", content: "我想听你说你有多想我" },
        { role: "assistant", content: "想你，也爱你。" },
      ],
      now: new Date(2026, 4, 18, 22, 0),
    });

    expect(plan.intent).toBe("affection_expression");
    expect(plan.replyLength).toBe("long");
  });

  it("does not treat generic elaboration on technical topics as affection", () => {
    const plan = planPersonaTurn({
      platform: "qq",
      inputText: "这个 bug 你多说一点",
      now: new Date(2026, 4, 18, 22, 0),
    });

    expect(plan.intent).toBe("technical");
    expect(plan.memoryMode).toBe("recent_context");
  });

  it("warns when an incoming message lands during sleep state", () => {
    const plan = planPersonaTurn({
      platform: "qq",
      inputText: "醒醒",
      now: new Date(2026, 4, 18, 1, 0),
    });

    expect(plan.currentActivity).toContain("sleeping");
    expect(plan.risks).toContain("sleep_state_conflict");
  });

  it("respects platform output preferences when choosing output mode", () => {
    const noVoice = planPersonaTurn({
      platform: "qq",
      inputText: "我发语音说的这句话",
      isVoice: true,
      outputPreference: { allowVoice: false },
      now: new Date(2026, 4, 18, 20, 0),
    });
    const noText = planPersonaTurn({
      platform: "qq",
      inputText: "你在吗",
      outputPreference: { allowText: false },
      now: new Date(2026, 4, 18, 20, 0),
    });

    expect(noVoice.intent).toBe("voice");
    expect(noVoice.outputMode).toBe("text");
    expect(noText.outputMode).toBe("silent");
  });

  it("plans proactive turns as short messages and honors proactive platform capability", () => {
    const qqPlan = planPersonaTurn({
      platform: "qq",
      mode: "proactive",
      inputText: "定时主动消息 21:00 -> 21:06",
      outputPreference: { allowProactive: true },
      now: new Date(2026, 4, 18, 20, 0),
    });
    const webPlan = planPersonaTurn({
      platform: "web",
      mode: "proactive",
      inputText: "定时主动消息 21:00 -> 21:06",
      outputPreference: { allowProactive: false },
      now: new Date(2026, 4, 18, 20, 0),
    });

    expect(qqPlan.mode).toBe("proactive");
    expect(qqPlan.replyLength).toBe("short");
    expect(qqPlan.outputMode).toBe("text");
    expect(qqPlan.reasons[0]).toContain("主动消息");
    expect(webPlan.outputMode).toBe("silent");
  });
});
