import { describe, expect, it } from "vitest";
import { buildLlmEconomyPolicy } from "../llm/economy";
import { checkVoiceReplyPolicy } from "./voice-reply-policy";

const baseConfig = {
  enabled: true,
  mode: "sometimes" as const,
  probability: 0.25,
  onlyWhenUserSentVoice: true,
  maxTextLength: 90,
  cooldownSeconds: 0,
  allowInGroup: false,
  smartProvider: "",
  smartMinConfidence: 0.68,
};

describe("voice reply policy", () => {
  it("selects voice when the user explicitly asks for it", async () => {
    const result = await checkVoiceReplyPolicy({
      contactId: "qq:private:1",
      contactKind: "private",
      inputText: "用语音回我",
      replyText: "行，我说给你听。",
      source: "text",
      random: () => 0.99,
      config: baseConfig,
    });

    expect(result.shouldSendVoice).toBe(true);
    expect(result.reason).toBe("voice_reply_selected_by_request");
  });

  it("skips long replies", async () => {
    const result = await checkVoiceReplyPolicy({
      contactId: "qq:private:1",
      contactKind: "private",
      inputText: "今天聊会儿吗",
      replyText: "这是一段很长很长的回复".repeat(20),
      source: "voice",
      config: baseConfig,
    });

    expect(result.shouldSendVoice).toBe(false);
    expect(result.reason).toBe("voice_reply_skipped_by_length");
  });

  it("lets explicit voice requests override length and cooldown rules", async () => {
    const result = await checkVoiceReplyPolicy({
      contactId: "qq:private:1",
      contactKind: "private",
      inputText: "这段用语音回我",
      replyText: "这是一段很长很长的回复".repeat(20),
      replyChunks: ["这是一段很长很长的回复".repeat(20)],
      source: "text",
      nowMs: 1_000,
      config: { ...baseConfig, mode: "smart", maxTextLength: 20, cooldownSeconds: 90 },
    });

    expect(result.shouldSendVoice).toBe(true);
    expect(result.reason).toBe("voice_reply_selected_by_request");
  });

  it("uses the model voice request decision as the authoritative forced-voice signal", async () => {
    const result = await checkVoiceReplyPolicy({
      contactId: "qq:private:1",
      contactKind: "private",
      inputText: "换个说法让我听你说一长段",
      replyText: "这是一段会超过普通语音长度限制的回复。".repeat(12),
      replyChunks: ["这是一段会超过普通语音长度限制的回复。".repeat(12)],
      source: "text",
      nowMs: 1_000,
      voiceRequestDecision: {
        explicitVoiceRequest: true,
        confidence: 0.91,
        reason: "用户在语义上要求听角色说话",
      },
      config: { ...baseConfig, mode: "smart", maxTextLength: 20, cooldownSeconds: 90 },
    });

    expect(result.shouldSendVoice).toBe(true);
    expect(result.reason).toBe("voice_reply_selected_by_request");
  });

  it("keeps voice forced for follow-up wording when the classifier falls back to context", async () => {
    const result = await checkVoiceReplyPolicy({
      contactId: "qq:private:1",
      contactKind: "private",
      inputText: "再多说一点，别这么短",
      conversationContext: [
        "上一条用户消息：我要听你发长一点的语音，我要听你表白",
        "上一条角色回复：爱你，也想你。",
      ].join("\n"),
      replyText: "这是一段会超过普通语音长度限制的回复。".repeat(12),
      replyChunks: ["这是一段会超过普通语音长度限制的回复。".repeat(12)],
      source: "text",
      nowMs: 1_000,
      config: { ...baseConfig, mode: "smart", maxTextLength: 20, cooldownSeconds: 90 },
    });

    expect(result.shouldSendVoice).toBe(true);
    expect(result.reason).toBe("voice_reply_selected_by_request");
  });

  it("does not force voice from text matching when the model decision says it is not a request", async () => {
    const result = await checkVoiceReplyPolicy({
      contactId: "qq:private:1",
      contactKind: "private",
      inputText: "我在说这个发语音的功能，不是在让你发语音",
      replyText: "知道了。",
      source: "text",
      voiceRequestDecision: {
        explicitVoiceRequest: false,
        confidence: 0.88,
        reason: "用户在讨论功能，不是请求本轮语音回复",
      },
      config: { ...baseConfig, mode: "requested", onlyWhenUserSentVoice: false },
    });

    expect(result.shouldSendVoice).toBe(false);
    expect(result.reason).toBe("voice_reply_skipped_by_request_only");
  });

  it("recognizes natural Chinese voice request phrases as explicit", async () => {
    const phrases = [
      "你给我说话",
      "我要听你的声音",
      "说给我听",
      "说三遍，发语音",
      "发一段语音给我",
      "太短了，我要听你发长一点的语音，我要听你表白！",
      "我要现在就\n听你发长语音",
      "语音长一点",
    ];

    for (const phrase of phrases) {
      const result = await checkVoiceReplyPolicy({
        contactId: `qq:private:${phrase}`,
        contactKind: "private",
        inputText: phrase,
        replyText: "这是一段会超过普通语音长度限制的回复。".repeat(12),
        replyChunks: ["这是一段会超过普通语音长度限制的回复。".repeat(12)],
        source: "text",
        nowMs: 2_000,
        config: { ...baseConfig, mode: "smart", maxTextLength: 20, cooldownSeconds: 90 },
      });

      expect(result.shouldSendVoice).toBe(true);
      expect(result.reason).toBe("voice_reply_selected_by_request");
    }
  });

  it("skips the whole turn when any reply chunk is too long", async () => {
    const result = await checkVoiceReplyPolicy({
      contactId: "qq:private:1",
      contactKind: "private",
      inputText: "今天聊会儿吗",
      replyText: "短的。\n" + "这段太长".repeat(20),
      replyChunks: ["短的。", "这段太长".repeat(20)],
      source: "text",
      config: { ...baseConfig, mode: "smart", onlyWhenUserSentVoice: false, maxTextLength: 30 },
      smartJudge: async () => ({ shouldSendVoice: true, confidence: 0.9 }),
    });

    expect(result.shouldSendVoice).toBe(false);
    expect(result.reason).toBe("voice_reply_skipped_by_length");
  });

  it("skips non-explicit smart voice when the reply has too many chunks", async () => {
    const result = await checkVoiceReplyPolicy({
      contactId: "qq:private:1",
      contactKind: "private",
      inputText: "你在干嘛",
      replyText: "我刚到家。\n先倒杯水。\n桌上还有点资料。\n等会再看。",
      replyChunks: ["我刚到家。", "先倒杯水。", "桌上还有点资料。", "等会再看。"],
      source: "text",
      config: { ...baseConfig, mode: "smart", onlyWhenUserSentVoice: false, maxTextLength: 30 },
      smartJudge: async () => ({ shouldSendVoice: true, confidence: 0.9 }),
    });

    expect(result.shouldSendVoice).toBe(false);
    expect(result.reason).toBe("voice_reply_skipped_by_length");
  });

  it("skips non-explicit smart voice when the whole voice text is too long", async () => {
    const result = await checkVoiceReplyPolicy({
      contactId: "qq:private:1",
      contactKind: "private",
      inputText: "你说吧",
      replyText: "这段回复本身不是技术内容，但如果把它合成一整条语音，就会太长，听起来容易拖，也会让本地 VoxCPM 更容易生成失真。".repeat(2),
      replyChunks: [
        "这段回复本身不是技术内容，但如果把它合成一整条语音，就会太长。",
        "听起来容易拖，也会让本地 VoxCPM 更容易生成失真。",
      ],
      source: "text",
      config: { ...baseConfig, mode: "smart", onlyWhenUserSentVoice: false, maxTextLength: 70 },
      smartJudge: async () => ({ shouldSendVoice: true, confidence: 0.9 }),
    });

    expect(result.shouldSendVoice).toBe(false);
    expect(result.reason).toBe("voice_reply_skipped_by_length");
  });

  it("uses probability for normal voice inputs", async () => {
    const selected = await checkVoiceReplyPolicy({
      contactId: "qq:private:1",
      contactKind: "private",
      inputText: "你在吗",
      replyText: "在。",
      source: "voice",
      random: () => 0.1,
      config: baseConfig,
    });
    const skipped = await checkVoiceReplyPolicy({
      contactId: "qq:private:2",
      contactKind: "private",
      inputText: "你在吗",
      replyText: "在。",
      source: "voice",
      random: () => 0.9,
      config: baseConfig,
    });

    expect(selected.shouldSendVoice).toBe(true);
    expect(skipped.shouldSendVoice).toBe(false);
  });

  it("only sends voice on explicit request in requested mode", async () => {
    const normal = await checkVoiceReplyPolicy({
      contactId: "qq:private:1",
      contactKind: "private",
      inputText: "你在吗",
      replyText: "在。",
      source: "voice",
      random: () => 0,
      config: { ...baseConfig, mode: "requested", onlyWhenUserSentVoice: false },
    });
    const requested = await checkVoiceReplyPolicy({
      contactId: "qq:private:1",
      contactKind: "private",
      inputText: "用语音回我",
      replyText: "在，我说给你听。",
      source: "text",
      random: () => 0.99,
      config: { ...baseConfig, mode: "requested", onlyWhenUserSentVoice: false },
    });

    expect(normal.shouldSendVoice).toBe(false);
    expect(normal.reason).toBe("voice_reply_skipped_by_request_only");
    expect(requested.shouldSendVoice).toBe(true);
    expect(requested.reason).toBe("voice_reply_selected_by_request");
  });

  it("uses the smart judge for natural short replies", async () => {
    const result = await checkVoiceReplyPolicy({
      contactId: "qq:private:1",
      contactKind: "private",
      inputText: "今天有点累",
      replyText: "那我陪你聊会儿，早点躺下。",
      source: "text",
      config: { ...baseConfig, mode: "smart", onlyWhenUserSentVoice: false },
      smartJudge: async () => ({ shouldSendVoice: true, confidence: 0.9, reason: "口语化安慰" }),
    });

    expect(result.shouldSendVoice).toBe(true);
    expect(result.reason).toBe("voice_reply_selected_by_smart");
  });

  it("skips non-explicit voice replies in strict economy mode", async () => {
    const result = await checkVoiceReplyPolicy({
      contactId: "qq:private:budget",
      contactKind: "private",
      inputText: "今天有点累",
      replyText: "那我陪你聊会儿，早点躺下。",
      source: "text",
      config: { ...baseConfig, mode: "smart", onlyWhenUserSentVoice: false },
      economyPolicy: buildLlmEconomyPolicy({
        today: { totalTokens: 120 },
      }, {
        dailyLimit: 100,
      }),
      smartJudge: async () => ({ shouldSendVoice: true, confidence: 0.9, reason: "口语化安慰" }),
    });

    expect(result.shouldSendVoice).toBe(false);
    expect(result.reason).toBe("voice_reply_skipped_by_llm_budget");
  });

  it("keeps explicit voice requests available in strict economy mode", async () => {
    const result = await checkVoiceReplyPolicy({
      contactId: "qq:private:budget-explicit",
      contactKind: "private",
      inputText: "用语音回我",
      replyText: "好，我说给你听。",
      source: "text",
      random: () => 0.99,
      config: { ...baseConfig, mode: "smart", onlyWhenUserSentVoice: false },
      economyPolicy: buildLlmEconomyPolicy({
        today: { totalTokens: 120 },
      }, {
        dailyLimit: 100,
      }),
    });

    expect(result.shouldSendVoice).toBe(true);
    expect(result.reason).toBe("voice_reply_selected_by_request");
  });

  it("keeps smart judge conservative when confidence is low", async () => {
    const result = await checkVoiceReplyPolicy({
      contactId: "qq:private:1",
      contactKind: "private",
      inputText: "今天有点累",
      replyText: "那我陪你聊会儿。",
      source: "text",
      config: { ...baseConfig, mode: "smart", onlyWhenUserSentVoice: false, smartMinConfidence: 0.8 },
      smartJudge: async () => ({ shouldSendVoice: true, confidence: 0.5, reason: "不确定" }),
    });

    expect(result.shouldSendVoice).toBe(false);
    expect(result.reason).toBe("voice_reply_skipped_by_smart_confidence");
  });
});
