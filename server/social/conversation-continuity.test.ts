import { describe, expect, it } from "vitest";
import {
  buildConversationContinuityInstruction,
  formatRecentConversationTimeline,
} from "./conversation-continuity";

describe("conversation continuity", () => {
  it("marks unanswered assistant questions for proactive follow-up", () => {
    const instruction = buildConversationContinuityInstruction([
      { role: "assistant", content: "敏子，晚饭吃了没有？别一忙就空着肚子。", channel: "web", createdAt: new Date(2026, 4, 14, 18, 0) },
    ], "王芃泽", "proactive");

    expect(instruction).toContain("用户还没有回应");
    expect(instruction).toContain("不要直接换成另一个无关问题");
    expect(instruction).toContain("吃饭");
  });

  it("formats recent timeline with roles and channels", () => {
    const timeline = formatRecentConversationTimeline([
      { role: "user", content: "我刚下课", channel: "qq", createdAt: new Date(2026, 4, 14, 20, 20) },
      { role: "assistant", content: "先去吃点东西。", channel: "web", createdAt: new Date(2026, 4, 14, 20, 21) },
    ], "王芃泽");

    expect(timeline).toContain("用户/qq：我刚下课");
    expect(timeline).toContain("王芃泽/web：先去吃点东西。");
  });

  it("warns against burst replies when multiple user messages are unanswered", () => {
    const instruction = buildConversationContinuityInstruction([
      { role: "assistant", content: "我刚到家，你吃饭了吗？", createdAt: new Date(2026, 4, 14, 18, 5) },
      { role: "user", content: "还没", createdAt: new Date(2026, 4, 14, 18, 6) },
      { role: "user", content: "今天被学生折腾晕了", createdAt: new Date(2026, 4, 14, 18, 7) },
      { role: "user", content: "你别又催我睡觉", createdAt: new Date(2026, 4, 14, 18, 8) },
    ], "王芃泽", "reply");

    expect(instruction).toContain("连续发了 3 条还没有得到回应");
    expect(instruction).toContain("只生成一次综合回复");
    expect(instruction).toContain("不要为每条旧消息分别补答");
  });
});
