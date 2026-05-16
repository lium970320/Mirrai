import { describe, expect, it } from "vitest";
import { checkStickerReplyPolicy } from "./sticker-policy";

const baseConfig = {
  enabled: true,
  probability: 0.2,
  maxReplyLength: 80,
  cooldownSeconds: 0,
  allowInGroup: false,
  allowAfterUserSticker: true,
  allowAfterUserJoke: true,
  allowAfterUserTease: true,
};

describe("sticker reply policy", () => {
  it("selects sticker when policy and intent both allow it", () => {
    const result = checkStickerReplyPolicy({
      contactId: "qq:private:1",
      contactKind: "private",
      inputText: "哈哈你还挺嘴硬",
      replyText: "行了，别闹。",
      stickerIntent: { shouldSend: true, mood: "吐槽", intensity: 3, tags: ["tease"] },
      random: () => 0,
      config: baseConfig,
    });

    expect(result.shouldSendSticker).toBe(true);
    expect(result.reason).toBe("sticker_selected_by_policy");
  });

  it("skips when the reply is too long", () => {
    const result = checkStickerReplyPolicy({
      contactId: "qq:private:1",
      contactKind: "private",
      inputText: "你说说看",
      replyText: "这是一段比较长的解释".repeat(20),
      stickerIntent: { shouldSend: true, mood: "认同" },
      random: () => 0,
      config: baseConfig,
    });

    expect(result.shouldSendSticker).toBe(false);
    expect(result.reason).toBe("sticker_skipped_by_length");
  });

  it("skips technical contexts", () => {
    const result = checkStickerReplyPolicy({
      contactId: "qq:private:1",
      contactKind: "private",
      inputText: "这个接口为什么报错",
      replyText: "我看一下日志。",
      stickerIntent: { shouldSend: true, mood: "困惑" },
      random: () => 0,
      config: baseConfig,
    });

    expect(result.shouldSendSticker).toBe(false);
    expect(result.reason).toBe("sticker_skipped_by_context");
  });

  it("skips groups by default", () => {
    const result = checkStickerReplyPolicy({
      contactId: "qq:group:1",
      contactKind: "group",
      inputText: "哈哈",
      replyText: "别闹。",
      stickerIntent: { shouldSend: true, mood: "吐槽" },
      random: () => 0,
      config: baseConfig,
    });

    expect(result.shouldSendSticker).toBe(false);
    expect(result.reason).toBe("sticker_skipped_by_group");
  });
});
