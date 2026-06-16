import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getQqBindingByContactId: vi.fn(),
  getSingleReadyPersonaForQqAutoBind: vi.fn(),
  createQqBinding: vi.fn(),
  handleSocialPersonaTextChatDetailed: vi.fn(),
  handleSocialPersonaMediaChat: vi.fn(),
}));

vi.mock("../_core/env", () => ({
  ENV: {
    qqAutoBindSingleReadyPersona: false,
  },
}));

vi.mock("../db", () => ({
  QQ_CONTACT_PREFIX: "qq:",
  getQqBindingByContactId: mocks.getQqBindingByContactId,
  getSingleReadyPersonaForQqAutoBind: mocks.getSingleReadyPersonaForQqAutoBind,
  createQqBinding: mocks.createQqBinding,
}));

vi.mock("../social/persona-text-chat", () => ({
  handleSocialPersonaTextChatDetailed: mocks.handleSocialPersonaTextChatDetailed,
}));

vi.mock("../social/persona-media-chat", () => ({
  handleSocialPersonaMediaChat: mocks.handleSocialPersonaMediaChat,
}));

import { handleQqPersonaChatDetailed, handleQqPersonaMediaChat } from "./persona-bridge";

describe("QQ persona bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getQqBindingByContactId.mockResolvedValue({
      personaId: 7,
      userId: 11,
    });
    mocks.handleSocialPersonaTextChatDetailed.mockResolvedValue({
      replyText: "我在。",
    });
    mocks.handleSocialPersonaMediaChat.mockResolvedValue("看到了。");
  });

  it("passes QQ text messages into the shared runtime with the qq channel", async () => {
    await handleQqPersonaChatDetailed("qq:private:12345", "敏子", "你在吗", {
      batchMessageCount: 1,
      batchMessages: ["你在吗"],
    });

    expect(mocks.handleSocialPersonaTextChatDetailed).toHaveBeenCalledWith(expect.objectContaining({
      platform: "qq",
      channel: "qq",
      outputPreference: {
        allowText: true,
        allowVoice: true,
        allowStickers: true,
        allowProactive: true,
      },
      contactName: "敏子",
      messageText: "你在吗",
      binding: {
        personaId: 7,
        userId: 11,
      },
    }));
  });

  it("passes QQ media messages into the shared runtime with the qq channel", async () => {
    await handleQqPersonaMediaChat("qq:private:12345", "敏子", {
      kind: "image",
      buffer: Buffer.from("png"),
      fileName: "a.png",
      mimeType: "image/png",
    });

    expect(mocks.handleSocialPersonaMediaChat).toHaveBeenCalledWith(expect.objectContaining({
      platform: "qq",
      channel: "qq",
      outputPreference: {
        allowText: true,
        allowVoice: true,
        allowStickers: true,
        allowProactive: true,
      },
      contactName: "敏子",
      storagePrefix: "qq",
      binding: {
        personaId: 7,
        userId: 11,
      },
    }));
  });
});
