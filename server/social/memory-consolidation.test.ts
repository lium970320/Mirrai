import { describe, expect, it } from "vitest";
import { shouldAttemptMemoryConsolidation } from "./memory-consolidation";
import type { PersonaReflection } from "./persona-reflection";
import type { PersonaTurnPlan } from "./persona-turn-planner";

const baseReflection: PersonaReflection = {
  intent: "daily_chat",
  shouldRecallMemory: false,
  memoryQueries: [],
  shouldRecordMemory: false,
  recordReason: "",
  innerReaction: "",
  replyStrategy: "",
  replyLength: "short",
  outputMode: "text",
  risks: ["none"],
  avoid: [],
  mood: "",
};

const basePlan: PersonaTurnPlan = {
  platform: "qq",
  mode: "reply",
  intent: "daily_chat",
  memoryMode: "recent_context",
  currentActivity: "evening_home/晚间家中",
  availability: "open",
  replyLength: "short",
  outputMode: "text",
  risks: ["none"],
  reasons: ["日常聊天"],
};

describe("memory consolidation gate", () => {
  it("skips short low-signal turns", () => {
    const decision = shouldAttemptMemoryConsolidation({
      userText: "嗯",
      assistantText: "我在。",
      reflection: baseReflection,
      turnPlan: basePlan,
      sourceRecallUsed: false,
    });

    expect(decision.attempt).toBe(false);
    expect(decision.reason).toContain("过短");
  });

  it("trusts reflection when it marks the turn as record-worthy", () => {
    const decision = shouldAttemptMemoryConsolidation({
      userText: "以后不要每次都催我睡觉，我会觉得你在敷衍我。",
      assistantText: "好，我记住。",
      reflection: {
        ...baseReflection,
        shouldRecordMemory: true,
        recordReason: "用户明确表达了偏好和边界。",
      },
      turnPlan: { ...basePlan, intent: "emotional_support", memoryMode: "relationship_ledger" },
      sourceRecallUsed: false,
    });

    expect(decision.attempt).toBe(true);
    expect(decision.reason).toContain("偏好");
  });

  it("guards source recall turns from being written as shared memories", () => {
    const decision = shouldAttemptMemoryConsolidation({
      userText: "原著里中考那段是怎么写的？",
      assistantText: "原文大概写到考场外很热。",
      reflection: { ...baseReflection, shouldRecordMemory: true },
      turnPlan: { ...basePlan, intent: "source_recall", memoryMode: "source_library" },
      sourceRecallUsed: true,
    });

    expect(decision.attempt).toBe(false);
    expect(decision.reason).toContain("原著");
  });
});

