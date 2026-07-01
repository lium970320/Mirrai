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

  it("honors economy context limits for the recent timeline", () => {
    const messages = Array.from({ length: 10 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `第 ${index + 1} 条`,
      createdAt: new Date(2026, 4, 14, 18, index),
    }));

    const instruction = buildConversationContinuityInstruction(messages, "王芃泽", "reply", {
      recentLimit: 4,
      timelineLimit: 3,
    });

    expect(instruction).not.toContain("第 6 条");
    expect(instruction).toContain("第 8 条");
    expect(instruction).toContain("第 10 条");
  });

  it("warns against repeating recent statements (not just questions) and lists them as anchors in reply mode", () => {
    const instruction = buildConversationContinuityInstruction([
      { role: "user", content: "在吗" },
      { role: "assistant", content: "我刚泡了杯茶，靠在窗边看楼下的梧桐。" },
      { role: "user", content: "嗯" },
    ], "王芃泽", "reply");

    expect(instruction).toContain("不要原样或近义重复你最近几轮已经说过的整句或整段");
    expect(instruction).toContain("本轮别再原样或近义复述");
    expect(instruction).toContain("我刚泡了杯茶");
  });

  it("does not add the reply-mode repeat anchors for proactive mode", () => {
    const instruction = buildConversationContinuityInstruction([
      { role: "assistant", content: "我刚泡了杯茶，靠在窗边看楼下的梧桐。" },
    ], "王芃泽", "proactive");

    expect(instruction).not.toContain("本轮别再原样或近义复述");
  });
});
