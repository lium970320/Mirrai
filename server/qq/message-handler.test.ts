import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";

const mocks = vi.hoisted(() => ({
  sendQqText: vi.fn(),
  sendQqRecordFile: vi.fn(),
  getQqRecordFile: vi.fn(),
  sendQqSticker: vi.fn(),
  handleQqPersonaChatDetailed: vi.fn(),
  handleQqPersonaMediaChat: vi.fn(),
  normalizeAudioForAsr: vi.fn(),
  transcribeWithZhipuAsr: vi.fn(),
  generateTTSFile: vi.fn(),
  pendingBatches: [] as Promise<unknown>[],
}));

vi.mock("../_core/env", () => ({
  ENV: {
    qqAllowGroups: false,
    qqTtsVoice: "test-voice",
    ttsProvider: "test-tts",
    voxcpmTimeoutMs: 120_000,
    qqVoiceReplyEnabled: true,
    qqVoiceReplyMode: "requested",
    qqVoiceReplyProbability: 0.25,
    qqVoiceReplyOnlyWhenUserSentVoice: false,
    qqVoiceReplyMaxTextLength: 45,
    qqVoiceReplyCooldownSeconds: 0,
    qqVoiceReplyAllowGroups: false,
    qqVoiceReplySmartProvider: "",
    qqVoiceReplySmartMinConfidence: 0.68,
    qqStickerReplyEnabled: true,
    qqStickerReplyProbability: 1,
    qqStickerReplyMaxReplyLength: 90,
    qqStickerReplyCooldownSeconds: 0,
    qqStickerReplyAllowGroups: false,
    qqStickerReplyAllowAfterUserSticker: true,
    qqStickerReplyAllowAfterUserJoke: true,
    qqStickerReplyAllowAfterUserTease: true,
    qqStickerReplyAvoidRepeatRecentCount: 3,
    qqStickerBaseDir: "F:/tmp/mirrai-test-stickers",
    qqOnebotBaseUrl: "http://127.0.0.1:3001",
    qqOnebotAccessToken: "",
  },
}));

vi.mock("./onebot-client", async () => {
  const actual = await vi.importActual<typeof import("./onebot-client")>("./onebot-client");
  return {
    ...actual,
    getQqRecordFile: mocks.getQqRecordFile,
    sendQqRecordFile: mocks.sendQqRecordFile,
    sendQqText: mocks.sendQqText,
  };
});

vi.mock("./persona-bridge", () => ({
  handleQqPersonaChatDetailed: mocks.handleQqPersonaChatDetailed,
  handleQqPersonaMediaChat: mocks.handleQqPersonaMediaChat,
}));

vi.mock("../voice/audio-normalizer", () => ({
  normalizeAudioForAsr: mocks.normalizeAudioForAsr,
}));

vi.mock("../voice/zhipu-asr", () => ({
  transcribeWithZhipuAsr: mocks.transcribeWithZhipuAsr,
}));

vi.mock("../_core/tts", () => ({
  generateTTSFile: mocks.generateTTSFile,
}));

vi.mock("../stickers/sticker-sender", () => ({
  sendQqSticker: mocks.sendQqSticker,
}));

vi.mock("../wechat/incoming-message-batcher", async () => {
  const actual = await vi.importActual<typeof import("../wechat/incoming-message-batcher")>("../wechat/incoming-message-batcher");
  return {
    ...actual,
    enqueueWechatTextMessage: vi.fn((options: any) => {
      mocks.pendingBatches.push(Promise.resolve(options.onBatch({
        contact: options.contact,
        contactId: options.contactId,
        contactName: options.contactName,
        messages: [options.text],
        combinedText: options.text,
        messageCount: 1,
        batchRevision: 1,
        isStale: () => false,
      })));
    }),
  };
});

import {
  buildQqContactKey,
  extractQqImageSegments,
  extractQqPlainText,
  extractQqRecordSegments,
  handleQqOneBotEvent,
} from "./message-handler";

async function waitForQueuedReply() {
  const pending = mocks.pendingBatches.splice(0);
  if (pending.length > 0) {
    await Promise.allSettled(pending);
  }
}

let infoSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

function expectInfoLogContaining(text: string) {
  const calls = infoSpy.mock.calls.map(call => call.map(String).join(" "));
  expect(calls.some(call => call.includes(text)), `expected info log containing "${text}" in:\n${calls.join("\n")}`).toBe(true);
}

function expectWarnLogContaining(text: string) {
  const calls = warnSpy.mock.calls.map(call => call.map(String).join(" "));
  expect(calls.some(call => call.includes(text)), `expected warn log containing "${text}" in:\n${calls.join("\n")}`).toBe(true);
}

describe("QQ OneBot message handling helpers", () => {
  it("builds private and group contact keys", () => {
    expect(buildQqContactKey({ message_type: "private", user_id: 12345 })).toBe("qq:private:12345");
    expect(buildQqContactKey({ message_type: "group", group_id: "67890" })).toBe("qq:group:67890");
  });

  it("extracts text from array message segments", () => {
    expect(extractQqPlainText([
      { type: "text", data: { text: "中考的时候" } },
      { type: "image", data: { file: "a.jpg" } },
      { type: "face", data: { id: "14" } },
      { type: "record", data: { file: "voice.silk" } },
    ])).toBe("中考的时候 [图片] [表情] [语音]");
  });

  it("normalizes CQ-code string messages", () => {
    expect(extractQqPlainText("看这个[CQ:image,file=a.jpg]哈哈[CQ:face,id=14]"))
      .toBe("看这个 [图片] 哈哈 [表情]");
  });

  it("extracts QQ image segments from array and CQ-code messages", () => {
    expect(extractQqImageSegments([
      { type: "text", data: { text: "看" } },
      { type: "image", data: { file: "a.jpg", url: "https://example.test/a.jpg" } },
    ])).toHaveLength(1);
    expect(extractQqImageSegments("看这个[CQ:image,file=a.jpg,url=https://example.test/a.jpg]"))
      .toEqual([{ type: "image", data: { file: "a.jpg", url: "https://example.test/a.jpg" } }]);
  });

  it("extracts QQ record segments from array and CQ-code messages", () => {
    expect(extractQqRecordSegments([
      { type: "text", data: { text: "听一下" } },
      { type: "record", data: { file: "voice.silk", file_id: "abc" } },
    ])).toEqual([{ type: "record", data: { file: "voice.silk", file_id: "abc" } }]);
    expect(extractQqRecordSegments("[CQ:record,file=voice.silk,file_id=abc]"))
      .toEqual([{ type: "record", data: { file: "voice.silk", file_id: "abc" } }]);
  });
});

describe("QQ OneBot event handling", () => {
  beforeEach(() => {
    mocks.pendingBatches.length = 0;
    vi.clearAllMocks();
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.sendQqText.mockResolvedValue(true);
    mocks.sendQqRecordFile.mockResolvedValue(true);
    mocks.sendQqSticker.mockResolvedValue({ ok: false, status: "sticker_send_failed", reason: "test_disabled" });
    mocks.handleQqPersonaChatDetailed.mockResolvedValue({
      replyText: "我在。",
      voiceRequestDecision: {
        explicitVoiceRequest: false,
        confidence: 0.35,
        reason: "test",
      },
    });
    mocks.handleQqPersonaMediaChat.mockResolvedValue("这张图我看到了。");
    mocks.normalizeAudioForAsr.mockResolvedValue({
      ok: true,
      buffer: Buffer.from("wav"),
      fileName: "voice.wav",
      mimeType: "audio/wav",
    });
    mocks.transcribeWithZhipuAsr.mockResolvedValue({ ok: true, transcript: "我刚发了一条语音" });
    mocks.generateTTSFile.mockResolvedValue({ filePath: "F:/tmp/voice.wav", provider: "test", voice: "test-voice" });
  });

  afterEach(async () => {
    await waitForQueuedReply();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("routes a private text message into the shared persona runtime and sends the text reply", async () => {
    const result = await handleQqOneBotEvent({
      post_type: "message",
      message_type: "private",
      user_id: 12345,
      message_id: 1,
      sender: { nickname: "敏子" },
      message: [{ type: "text", data: { text: "你在吗" } }],
    });

    expect(result).toEqual({ handled: true });
    await waitForQueuedReply();
    expect(mocks.handleQqPersonaChatDetailed).toHaveBeenCalledWith(
      "qq:private:12345",
      "敏子",
      "你在吗",
      expect.objectContaining({
        batchMessageCount: 1,
        batchMessages: ["你在吗"],
      }),
    );
    expect(mocks.sendQqText).toHaveBeenCalledWith("qq:private:12345", "我在。");
  });

  it("skips group messages while group support is disabled", async () => {
    const result = await handleQqOneBotEvent({
      post_type: "message",
      message_type: "group",
      group_id: 67890,
      user_id: 12345,
      message: [{ type: "text", data: { text: "群里说话" } }],
    });

    expect(result).toEqual({ handled: false, reason: "group_disabled" });
    expect(mocks.handleQqPersonaChatDetailed).not.toHaveBeenCalled();
    expect(mocks.sendQqText).not.toHaveBeenCalled();
  });

  it("falls back to text when QQ voice input has no resolvable record file", async () => {
    mocks.getQqRecordFile.mockResolvedValue(null);

    const result = await handleQqOneBotEvent({
      post_type: "message",
      message_type: "private",
      user_id: 12345,
      message_id: 2,
      message: [{ type: "record", data: { file_id: "missing" } }],
    });

    expect(result).toEqual({ handled: true, reason: "voice_download_failed" });
    expect(mocks.normalizeAudioForAsr).not.toHaveBeenCalled();
    expect(mocks.transcribeWithZhipuAsr).not.toHaveBeenCalled();
    expect(mocks.sendQqText).toHaveBeenCalledWith("qq:private:12345", "这条语音我没听清，你再发一次。");
    expectInfoLogContaining("voice_in_received platform=qq messageId=2");
    expectWarnLogContaining("voice_in_download_failed platform=qq messageId=2 reason=no_record_info");
  });

  it("transcribes a base64 QQ voice message, replies through the shared runtime, and sends a voice reply when selected", async () => {
    mocks.handleQqPersonaChatDetailed.mockResolvedValue({
      replyText: "我听见了。",
      voiceRequestDecision: {
        explicitVoiceRequest: true,
        confidence: 0.9,
        reason: "test_explicit_voice",
      },
    });

    const result = await handleQqOneBotEvent({
      post_type: "message",
      message_type: "private",
      user_id: 12345,
      message_id: 3,
      sender: { nickname: "敏子" },
      message: [{ type: "record", data: { file: `base64://${Buffer.from("audio").toString("base64")}` } }],
    });

    expect(result).toEqual({ handled: true });
    expect(mocks.normalizeAudioForAsr).toHaveBeenCalledWith(expect.any(Buffer), "qq-voice-3.mp3", "audio/mpeg");
    expect(mocks.transcribeWithZhipuAsr).toHaveBeenCalledWith(expect.objectContaining({
      fileName: "voice.wav",
      mimeType: "audio/wav",
      userId: "qq:private:12345",
    }));
    expect(mocks.handleQqPersonaChatDetailed).toHaveBeenCalledWith(
      "qq:private:12345",
      "敏子",
      "我刚发了一条语音",
      expect.objectContaining({
        batchMessageCount: 1,
        batchMessages: ["我刚发了一条语音"],
      }),
    );
    expect(mocks.generateTTSFile).toHaveBeenCalledWith(
      "我听见了。",
      "test-voice",
      undefined,
      expect.objectContaining({ maxTextLength: null }),
    );
    expect(mocks.sendQqRecordFile).toHaveBeenCalledWith("qq:private:12345", "F:/tmp/voice.wav");
    expect(mocks.sendQqText).not.toHaveBeenCalled();
    expectInfoLogContaining("voice_in_received platform=qq messageId=3");
    expectInfoLogContaining("voice_in_download_success platform=qq messageId=3");
    expectInfoLogContaining("voice_tts_start provider=test-tts contact=qq:private:12345");
    expectInfoLogContaining("voice_tts_success provider=test voice=test-voice outputChunks=1");
    expectInfoLogContaining("voice_send_success platform=qq contact=qq:private:12345 outputChunks=1");
  });

  it("falls back to text when QQ voice input cannot be normalized for ASR", async () => {
    mocks.normalizeAudioForAsr.mockResolvedValue({
      ok: false,
      status: "voice_transcode_failed",
      inputFormat: "silk",
      reason: "decoder failed",
    });

    const result = await handleQqOneBotEvent({
      post_type: "message",
      message_type: "private",
      user_id: 12345,
      message_id: 9,
      message: [{ type: "record", data: { file: `base64://${Buffer.from("bad silk").toString("base64")}` } }],
    });

    expect(result).toEqual({ handled: true, reason: "voice_transcode_failed" });
    expect(mocks.normalizeAudioForAsr).toHaveBeenCalledWith(expect.any(Buffer), "qq-voice-9.mp3", "audio/mpeg");
    expect(mocks.transcribeWithZhipuAsr).not.toHaveBeenCalled();
    expect(mocks.handleQqPersonaChatDetailed).not.toHaveBeenCalled();
    expect(mocks.sendQqText).toHaveBeenCalledWith("qq:private:12345", "这条语音格式我暂时解析不了，你再发一次。");
    expectWarnLogContaining("voice_in_normalize_failed_fallback_text platform=qq messageId=9 status=voice_transcode_failed");
    expectWarnLogContaining("input=silk reason=decoder failed");
  });

  it("falls back to text when QQ voice ASR fails after normalization", async () => {
    mocks.transcribeWithZhipuAsr.mockResolvedValue({
      ok: false,
      status: "asr_request_failed",
      reason: "HTTP 500",
      model: "test-asr",
    });

    const result = await handleQqOneBotEvent({
      post_type: "message",
      message_type: "private",
      user_id: 12345,
      message_id: 10,
      message: [{ type: "record", data: { file: `base64://${Buffer.from("audio").toString("base64")}` } }],
    });

    expect(result).toEqual({ handled: true, reason: "asr_request_failed" });
    expect(mocks.normalizeAudioForAsr).toHaveBeenCalledWith(expect.any(Buffer), "qq-voice-10.mp3", "audio/mpeg");
    expect(mocks.transcribeWithZhipuAsr).toHaveBeenCalledWith(expect.objectContaining({
      fileName: "voice.wav",
      mimeType: "audio/wav",
      userId: "qq:private:12345",
    }));
    expect(mocks.handleQqPersonaChatDetailed).not.toHaveBeenCalled();
    expect(mocks.sendQqText).toHaveBeenCalledWith("qq:private:12345", "这条语音我没听清，你再发一次。");
    expectWarnLogContaining("voice_asr_failed_fallback_text platform=qq messageId=10 status=asr_request_failed");
    expectWarnLogContaining("model=test-asr reason=HTTP 500");
  });

  it("falls back to text when selected voice output cannot be sent", async () => {
    mocks.handleQqPersonaChatDetailed.mockResolvedValue({
      replyText: "我听见了。",
      voiceRequestDecision: {
        explicitVoiceRequest: true,
        confidence: 0.9,
        reason: "test_explicit_voice",
      },
    });
    mocks.sendQqRecordFile.mockResolvedValue(false);

    const result = await handleQqOneBotEvent({
      post_type: "message",
      message_type: "private",
      user_id: 12345,
      message_id: 4,
      message: [{ type: "record", data: { file: `base64://${Buffer.from("audio").toString("base64")}` } }],
    });

    expect(result).toEqual({ handled: true });
    expect(mocks.sendQqRecordFile).toHaveBeenCalled();
    expect(mocks.sendQqText).toHaveBeenCalledWith("qq:private:12345", "我听见了。");
    expectWarnLogContaining("voice_send_failed_fallback_text platform=qq contact=qq:private:12345 outputChunks=1");
  });

  it("uses a safe fallback when explicit voice TTS fails instead of sending simulated voice narration", async () => {
    const simulatedVoiceReply = "（过了一小会儿发来一条语音消息，点开是低沉带点沙哑的声音：“听到了没？”）";
    mocks.handleQqPersonaChatDetailed.mockResolvedValue({
      replyText: simulatedVoiceReply,
      voiceRequestDecision: {
        explicitVoiceRequest: true,
        confidence: 0.95,
        reason: "test_explicit_voice",
      },
    });
    mocks.generateTTSFile.mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:8818"));

    const result = await handleQqOneBotEvent({
      post_type: "message",
      message_type: "private",
      user_id: 12345,
      message_id: 11,
      sender: { nickname: "敏子" },
      message: [{ type: "text", data: { text: "你发个语音来听听" } }],
    });

    expect(result).toEqual({ handled: true });
    await waitForQueuedReply();
    expect(mocks.generateTTSFile).toHaveBeenCalled();
    expect(mocks.sendQqRecordFile).not.toHaveBeenCalled();
    expect(mocks.sendQqText).toHaveBeenCalledTimes(1);
    const sentText = String(mocks.sendQqText.mock.calls[0]?.[1] ?? "");
    expect(sentText).toBe("我这边语音现在没发出来，刚才那句不能当语音听。等语音服务恢复了我再发。");
    expect(sentText).not.toBe(simulatedVoiceReply);
    expect(sentText).not.toContain("语音消息");
    expect(sentText).not.toContain("点开");
    expectWarnLogContaining("voice_tts_failed provider=test-tts contact=qq:private:12345");
    expectWarnLogContaining("voice_tts_failed_fallback_text platform=qq contact=qq:private:12345 explicit=true sanitized=true simulatedVoiceNarration=true");
  });

  it("sanitizes simulated voice narration when generated QQ voice cannot be sent", async () => {
    const simulatedVoiceReply = "（发来一条语音消息，点开是低低的声音：“别催。”）";
    mocks.handleQqPersonaChatDetailed.mockResolvedValue({
      replyText: simulatedVoiceReply,
      voiceRequestDecision: {
        explicitVoiceRequest: true,
        confidence: 0.9,
        reason: "test_explicit_voice",
      },
    });
    mocks.sendQqRecordFile.mockResolvedValue(false);

    const result = await handleQqOneBotEvent({
      post_type: "message",
      message_type: "private",
      user_id: 12345,
      message_id: 12,
      message: [{ type: "record", data: { file: `base64://${Buffer.from("audio").toString("base64")}` } }],
    });

    expect(result).toEqual({ handled: true });
    expect(mocks.generateTTSFile).toHaveBeenCalled();
    expect(mocks.sendQqRecordFile).toHaveBeenCalled();
    expect(mocks.sendQqText).toHaveBeenCalledTimes(1);
    const sentText = String(mocks.sendQqText.mock.calls[0]?.[1] ?? "");
    expect(sentText).toBe("我这边语音现在没发出来，刚才那句不能当语音听。等语音服务恢复了我再发。");
    expect(sentText).not.toBe(simulatedVoiceReply);
    expect(sentText).not.toContain("语音消息");
    expect(sentText).not.toContain("点开");
    expectWarnLogContaining("voice_send_failed_fallback_text platform=qq contact=qq:private:12345 outputChunks=1 explicit=true sanitized=true simulatedVoiceNarration=true");
  });

  it("routes image messages with usable base64 media into the QQ media runtime", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const result = await handleQqOneBotEvent({
      post_type: "message",
      message_type: "private",
      user_id: 12345,
      message_id: 5,
      sender: { nickname: "敏子" },
      message: [
        { type: "text", data: { text: "看这个" } },
        { type: "image", data: { file: `base64://${png.toString("base64")}`, summary: "普通图片" } },
      ],
    });

    expect(result).toEqual({ handled: true });
    expect(mocks.handleQqPersonaMediaChat).toHaveBeenCalledWith(
      "qq:private:12345",
      "敏子",
      expect.objectContaining({
        kind: "image",
        buffer: expect.any(Buffer),
        fileName: expect.stringMatching(/\.png$/),
        mimeType: "image/png",
        caption: "看这个",
      }),
    );
    expect(mocks.sendQqText).toHaveBeenCalledWith("qq:private:12345", "这张图我看到了。");
    expectInfoLogContaining("[QQ] Handling image message contact=qq:private:12345 messageId=5 images=1");
    expectInfoLogContaining("[QQ] Received image media:");
  });

  it("falls back to the text placeholder when an image segment has no usable media but text content exists", async () => {
    const result = await handleQqOneBotEvent({
      post_type: "message",
      message_type: "private",
      user_id: 12345,
      message_id: 6,
      sender: { nickname: "敏子" },
      message: [
        { type: "text", data: { text: "看这个图" } },
        { type: "image", data: { file: "missing.jpg" } },
      ],
    });

    expect(result).toEqual({ handled: true });
    await waitForQueuedReply();
    expect(mocks.handleQqPersonaMediaChat).not.toHaveBeenCalled();
    expect(mocks.handleQqPersonaChatDetailed).toHaveBeenCalledWith(
      "qq:private:12345",
      "敏子",
      "看这个图 [图片]",
      expect.any(Object),
    );
    expect(mocks.sendQqText).toHaveBeenCalledWith("qq:private:12345", "我在。");
    expectWarnLogContaining("[QQ] Image segment 1 has no usable URL, base64 data, or local file path.");
    expectWarnLogContaining("[QQ] Falling back to text-only image placeholder contact=qq:private:12345");
  });

  it("keeps the text reply when sticker policy selects but no matching sticker file exists", async () => {
    const existsSpy = vi.spyOn(fs, "existsSync").mockReturnValue(false);
    mocks.handleQqPersonaChatDetailed.mockResolvedValue({
      replyText: "别闹，哈哈。",
      voiceRequestDecision: {
        explicitVoiceRequest: false,
        confidence: 0.35,
        reason: "test",
      },
    });

    const result = await handleQqOneBotEvent({
      post_type: "message",
      message_type: "private",
      user_id: 22345,
      message_id: 7,
      sender: { nickname: "敏子" },
      message: [{ type: "text", data: { text: "你还挺贫哈哈" } }],
    });

    expect(result).toEqual({ handled: true });
    await waitForQueuedReply();
    expect(mocks.sendQqText).toHaveBeenCalledWith("qq:private:22345", "别闹，哈哈。");
    expect(existsSpy).toHaveBeenCalled();
    expect(mocks.sendQqSticker).not.toHaveBeenCalled();
    expectWarnLogContaining("sticker_not_found platform=qq contact=qq:private:22345 reason=no_matching_existing_sticker");
  });

  it("keeps the text reply when the selected sticker cannot be sent", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    mocks.handleQqPersonaChatDetailed.mockResolvedValue({
      replyText: "别闹，哈哈。",
      voiceRequestDecision: {
        explicitVoiceRequest: false,
        confidence: 0.35,
        reason: "test",
      },
    });
    mocks.sendQqSticker.mockResolvedValue({
      ok: false,
      status: "sticker_send_failed",
      reason: "onebot_send_failed",
    });

    const result = await handleQqOneBotEvent({
      post_type: "message",
      message_type: "private",
      user_id: 32345,
      message_id: 8,
      sender: { nickname: "敏子" },
      message: [{ type: "text", data: { text: "你还挺贫哈哈" } }],
    });

    expect(result).toEqual({ handled: true });
    await waitForQueuedReply();
    expect(mocks.sendQqText).toHaveBeenCalledWith("qq:private:32345", "别闹，哈哈。");
    expect(mocks.sendQqSticker).toHaveBeenCalledWith(
      "qq:private:32345",
      expect.objectContaining({
        id: expect.any(String),
        path: expect.stringMatching(/\.png$/),
        type: "png",
      }),
    );
    expectWarnLogContaining("sticker_send_failed_fallback_text platform=qq contact=qq:private:32345 reason=onebot_send_failed");
  });
});
