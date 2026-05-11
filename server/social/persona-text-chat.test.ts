import { describe, expect, it } from "vitest";
import { buildSocialTextInstruction, getRecentConversationContext } from "./persona-text-chat";

describe("social persona text chat", () => {
  it("adds short reply disambiguation with previous context", () => {
    const context = getRecentConversationContext([
      { id: 1, role: "user", content: "叔，你睡了吗" },
      { id: 2, role: "assistant", content: "还没呢，刚躺下。你怎么还不睡，明天打算赖床？" },
      { id: 3, role: "user", content: "没" },
    ], 3);

    const instruction = buildSocialTextInstruction("qq", "未完、待续", "没", {}, context);

    expect(instruction).toContain("没有打算赖床");
    expect(instruction).toContain("不是“没有睡”");
  });

  it("uses the same batching rules for WeChat and QQ", () => {
    const wechatInstruction = buildSocialTextInstruction("wechat", "敏子", "第一句\n第二句", {
      batchMessageCount: 2,
      batchMessages: ["第一句", "第二句"],
    });
    const qqInstruction = buildSocialTextInstruction("qq", "敏子", "第一句\n第二句", {
      batchMessageCount: 2,
      batchMessages: ["第一句", "第二句"],
    });

    expect(wechatInstruction).toContain("连续发来 2 条微信消息");
    expect(qqInstruction).toContain("连续发来 2 条QQ消息");
    expect(qqInstruction).toContain("不是多个独立问题");
  });

  it("guards against repeated sleep-topic closure after the user keeps chatting", () => {
    const context = getRecentConversationContext([
      { id: 1, role: "user", content: "这个表情包可爱吗" },
      { id: 2, role: "assistant", content: "行了，不早了，赶紧睡吧，明天醒了给我发消息。" },
      { id: 3, role: "user", content: "你好冷漠，不理你了" },
    ], 3);

    const instruction = buildSocialTextInstruction("qq", "敏子", "你好冷漠，不理你了", {}, context);

    expect(instruction).toContain("不要再催睡");
    expect(instruction).toContain("不要把对话赶去睡觉");
    expect(instruction).toContain("关系修复");
  });
});
