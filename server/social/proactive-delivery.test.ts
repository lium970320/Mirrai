import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActiveQqBindingsByPersonaId: vi.fn(),
  getQqBotStatus: vi.fn(),
  sendQqText: vi.fn(),
  sendQqRecordFile: vi.fn(),
  generateTTSFile: vi.fn(),
  selectSticker: vi.fn(),
  markStickerSent: vi.fn(),
  sendQqSticker: vi.fn(),
}));

vi.mock("../db", () => ({
  getActiveQqBindingsByPersonaId: mocks.getActiveQqBindingsByPersonaId,
}));

vi.mock("../qq/onebot-client", () => ({
  getQqBotStatus: mocks.getQqBotStatus,
  sendQqText: mocks.sendQqText,
  sendQqRecordFile: mocks.sendQqRecordFile,
}));

vi.mock("../_core/tts", () => ({
  generateTTSFile: mocks.generateTTSFile,
}));

vi.mock("../stickers/sticker-selector", () => ({
  selectSticker: mocks.selectSticker,
  markStickerSent: mocks.markStickerSent,
}));

vi.mock("../stickers/sticker-sender", () => ({
  sendQqSticker: mocks.sendQqSticker,
}));

import {
  resolveProactivePreferredTarget,
  sendProactiveMessageToPreferredPlatform,
  sendProactiveTextToPreferredPlatform,
} from "./proactive-delivery";

describe("proactive delivery channel routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActiveQqBindingsByPersonaId.mockResolvedValue([]);
    mocks.getQqBotStatus.mockResolvedValue({ status: "connected" });
    mocks.sendQqText.mockResolvedValue(true);
    mocks.sendQqRecordFile.mockResolvedValue(true);
    mocks.generateTTSFile.mockResolvedValue({ filePath: "/tmp/proactive.wav" });
    mocks.selectSticker.mockReturnValue({
      ok: true,
      sticker: { id: "s1", path: "/x.png", type: "image", mood: ["daily"], intensity: 2 },
    });
    mocks.sendQqSticker.mockResolvedValue({ ok: true, sentAs: "onebot_image" });
  });

  it("records successful QQ proactive delivery as the qq channel", async () => {
    mocks.getActiveQqBindingsByPersonaId.mockResolvedValue([
      { wechatContactId: "qq:private:12345" },
    ]);

    const result = await sendProactiveTextToPreferredPlatform(
      { id: 7, userId: 11, name: "王芃泽" },
      "我刚想到你。",
    );

    expect(result).toEqual({
      sent: true,
      channel: "qq",
      platform: "qq",
      modality: "text",
      reason: undefined,
    });
    expect(mocks.sendQqText).toHaveBeenCalledWith("qq:private:12345", "我刚想到你。");
  });

  it("keeps failed QQ proactive delivery on the qq channel", async () => {
    mocks.getActiveQqBindingsByPersonaId.mockResolvedValue([
      { wechatContactId: "qq:private:12345" },
    ]);
    mocks.getQqBotStatus.mockResolvedValue({ status: "error" });

    const result = await sendProactiveTextToPreferredPlatform(
      { id: 7, userId: 11 },
      "我刚想到你。",
    );

    expect(result).toEqual({
      sent: false,
      channel: "qq",
      platform: "qq",
      modality: "text",
      reason: "qq_offline",
    });
    expect(mocks.sendQqText).not.toHaveBeenCalled();
  });

  it("sends voice modality as a voice note and reports modality=voice", async () => {
    mocks.getActiveQqBindingsByPersonaId.mockResolvedValue([{ wechatContactId: "qq:private:12345" }]);

    const result = await sendProactiveMessageToPreferredPlatform(
      { id: 7, userId: 11 },
      "晚安。",
      "voice",
    );

    expect(result.sent).toBe(true);
    expect(result.modality).toBe("voice");
    expect(mocks.generateTTSFile).toHaveBeenCalledWith("晚安。");
    expect(mocks.sendQqRecordFile).toHaveBeenCalledWith("qq:private:12345", "/tmp/proactive.wav");
    expect(mocks.sendQqText).not.toHaveBeenCalled();
  });

  it("falls back to text when voice synthesis fails", async () => {
    mocks.getActiveQqBindingsByPersonaId.mockResolvedValue([{ wechatContactId: "qq:private:12345" }]);
    mocks.generateTTSFile.mockRejectedValue(new Error("tts down"));

    const result = await sendProactiveMessageToPreferredPlatform(
      { id: 7, userId: 11 },
      "晚安。",
      "voice",
    );

    expect(result.sent).toBe(true);
    expect(result.modality).toBe("text");
    expect(mocks.sendQqText).toHaveBeenCalledWith("qq:private:12345", "晚安。");
  });

  it("sends sticker modality as text plus a sticker", async () => {
    mocks.getActiveQqBindingsByPersonaId.mockResolvedValue([{ wechatContactId: "qq:private:12345" }]);

    const result = await sendProactiveMessageToPreferredPlatform(
      { id: 7, userId: 11 },
      "嘿嘿。",
      "sticker",
    );

    expect(result.sent).toBe(true);
    expect(result.modality).toBe("sticker");
    expect(mocks.sendQqText).toHaveBeenCalledWith("qq:private:12345", "嘿嘿。");
    expect(mocks.sendQqSticker).toHaveBeenCalled();
    expect(mocks.markStickerSent).toHaveBeenCalled();
  });

  it("keeps sticker modality as text when no sticker matches", async () => {
    mocks.getActiveQqBindingsByPersonaId.mockResolvedValue([{ wechatContactId: "qq:private:12345" }]);
    mocks.selectSticker.mockReturnValue({ ok: false, status: "sticker_not_found", reason: "no_match" });

    const result = await sendProactiveMessageToPreferredPlatform(
      { id: 7, userId: 11 },
      "嘿嘿。",
      "sticker",
    );

    expect(result.sent).toBe(true);
    expect(result.modality).toBe("text");
    expect(mocks.sendQqText).toHaveBeenCalledWith("qq:private:12345", "嘿嘿。");
    expect(mocks.sendQqSticker).not.toHaveBeenCalled();
  });

  it("resolves the preferred proactive runtime target before delivery", async () => {
    mocks.getActiveQqBindingsByPersonaId.mockResolvedValue([
      { wechatContactId: "qq:private:12345" },
    ]);

    const target = await resolveProactivePreferredTarget({ id: 7, userId: 11 });

    expect(target).toMatchObject({
      channel: "qq",
      platform: "qq",
      qqBindings: [{ wechatContactId: "qq:private:12345" }],
    });
  });

  it("falls back to the web channel when no proactive external binding exists", async () => {
    const target = await resolveProactivePreferredTarget({ id: 7, userId: 11 });

    expect(target).toMatchObject({
      channel: "web",
      platform: null,
      qqBindings: [],
    });
  });
});
