import { describe, expect, it } from "vitest";
import { checkVoiceReplyPolicy } from "./voice-reply-policy";

const baseConfig = {
  enabled: true,
  mode: "sometimes" as const,
  probability: 0.25,
  onlyWhenUserSentVoice: true,
  maxTextLength: 90,
  cooldownSeconds: 0,
  allowInGroup: false,
};

describe("voice reply policy", () => {
  it("selects voice when the user explicitly asks for it", () => {
    const result = checkVoiceReplyPolicy({
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

  it("skips long replies", () => {
    const result = checkVoiceReplyPolicy({
      contactId: "qq:private:1",
      contactKind: "private",
      inputText: "用语音回我",
      replyText: "这是一段很长很长的回复".repeat(20),
      source: "voice",
      config: baseConfig,
    });

    expect(result.shouldSendVoice).toBe(false);
    expect(result.reason).toBe("voice_reply_skipped_by_length");
  });

  it("uses probability for normal voice inputs", () => {
    const selected = checkVoiceReplyPolicy({
      contactId: "qq:private:1",
      contactKind: "private",
      inputText: "你在吗",
      replyText: "在。",
      source: "voice",
      random: () => 0.1,
      config: baseConfig,
    });
    const skipped = checkVoiceReplyPolicy({
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
});

