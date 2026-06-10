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

  it("lowers repeated lecture catchphrases and sleep-closure templates", () => {
    const context = getRecentConversationContext([
      { id: 1, role: "user", content: "你是不是又要说教" },
      { id: 2, role: "assistant", content: "你听好了，敏子，我心里有你。行了，别闹了，快睡。" },
      { id: 3, role: "user", content: "别再这样说了" },
    ], 3);

    const instruction = buildSocialTextInstruction("qq", "敏子", "别再这样说了", {}, context);

    expect(instruction).toContain("口癖降频");
    expect(instruction).toContain("不要把“你听好了”“听好了”作为常规开头");
    expect(instruction).toContain("不要用“行了，别闹了，快睡/睡吧/早点睡”作为机械收尾");
    expect(instruction).toContain("不要用“行了吧”“够真了”“够认真了”“够不够直接”");
    expect(instruction).toContain("本轮必须避开这些词");
  });

  it("constrains explicit voice replies to a short single audio message", () => {
    const instruction = buildSocialTextInstruction("qq", "敏子", "用语音回我", {});

    expect(instruction).toContain("约 45-90 字");
    expect(instruction).toContain("一条语音");
  });

  it("does not add voice synthesis instructions when the platform disallows voice output", () => {
    const instruction = buildSocialTextInstruction("wechat", "敏子", "用语音回我", {
      outputPreference: { allowVoice: false },
    });

    expect(instruction).not.toContain("会被合成一条语音");
    expect(instruction).not.toContain("一条语音");
  });

  it("uses the model voice request decision when the wording is not a direct keyword match", () => {
    const instruction = buildSocialTextInstruction("qq", "敏子", "换个说法让我听你说一长段", {
      voiceRequestDecision: {
        explicitVoiceRequest: true,
        confidence: 0.91,
        reason: "用户在语义上要求听角色说话",
      },
    });

    expect(instruction).toContain("约 80-140 字");
    expect(instruction).toContain("不要只给五六秒短句");
    expect(instruction).toContain("一条语音");
  });

  it("expands explicit affection voice requests instead of forcing a five-second reply", () => {
    const instruction = buildSocialTextInstruction("qq", "敏子", "我要听你发长一点的语音，我要听你表白", {
      voiceRequestDecision: {
        explicitVoiceRequest: true,
        confidence: 0.95,
        reason: "用户明确要求长语音表白",
      },
    });

    expect(instruction).toContain("更长、更深的爱意/表白/内心话");
    expect(instruction).toContain("约 90-150 字");
    expect(instruction).toContain("18-35 秒");
    expect(instruction).toContain("不要只重复“爱你、想你”");
  });

  it("treats 'say more' as affection when it follows romantic context", () => {
    const context = getRecentConversationContext([
      { id: 1, role: "user", content: "我想听你说你有多爱我" },
      { id: 2, role: "assistant", content: "爱你，也想你。" },
      { id: 3, role: "user", content: "再多说一点，别这么短" },
    ], 3);

    const instruction = buildSocialTextInstruction("qq", "敏子", "再多说一点，别这么短", {
      voiceRequestDecision: {
        explicitVoiceRequest: true,
        confidence: 0.9,
        reason: "承接上一轮要求长语音",
      },
    }, context);

    expect(instruction).toContain("深情表达请求");
    expect(instruction).toContain("不要压成五六秒");
    expect(instruction).toContain("约 90-150 字");
  });
});
