import { describe, expect, it } from "vitest";
import {
  fallbackPersonaReflection,
  formatPersonaReflectionInstruction,
  parsePersonaReflectionResponse,
} from "./persona-reflection";
import type { PersonaTurnPlan } from "./persona-turn-planner";

const basePlan: PersonaTurnPlan = {
  platform: "qq",
  mode: "reply",
  intent: "daily_chat",
  memoryMode: "recent_context",
  currentActivity: "evening_home/晚上在家",
  availability: "available",
  replyLength: "short",
  outputMode: "text",
  risks: ["none"],
  reasons: ["用户是在日常聊天。"],
};

describe("persona reflection", () => {
  it("parses hidden reflection JSON without exposing reply text", () => {
    const parsed = parsePersonaReflectionResponse(JSON.stringify({
      intent: "affection_expression",
      shouldRecallMemory: true,
      memoryQueries: ["异地想念", "上次嫌我敷衍"],
      shouldRecordMemory: true,
      recordReason: "用户明确要求更深的内心话。",
      innerReaction: "他意识到不能再用短句把话收住。",
      replyStrategy: "具体说想念和承诺，不要催睡。",
      replyLength: "long",
      outputMode: "text",
      risks: ["emotion_mismatch", "persona_drift"],
      avoid: ["不要说好了睡吧"],
      mood: "心软",
    }), fallbackPersonaReflection(basePlan));

    expect(parsed.intent).toBe("affection_expression");
    expect(parsed.shouldRecallMemory).toBe(true);
    expect(parsed.memoryQueries).toEqual(["异地想念", "上次嫌我敷衍"]);
    expect(parsed.risks).toContain("emotion_mismatch");
    expect(parsed.innerReaction).toContain("不能再用短句");
  });

  it("formats reflection as an internal prompt section", () => {
    const instruction = formatPersonaReflectionInstruction({
      ...fallbackPersonaReflection(basePlan),
      shouldRecallMemory: true,
      memoryQueries: ["武汉", "南京"],
      innerReaction: "他有点心软。",
      replyStrategy: "先接住撒娇，再短短回应。",
      risks: ["emotion_mismatch"],
    });

    expect(instruction).toContain("隐藏思考层");
    expect(instruction).toContain("记忆查询词：武汉；南京");
    expect(instruction).toContain("不要把 innerReaction 原样说出来");
  });
});
