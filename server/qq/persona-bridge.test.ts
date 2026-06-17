import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getQqBindingByContactId: vi.fn(),
  getSingleReadyPersonaForQqAutoBind: vi.fn(),
  createQqBinding: vi.fn(),
  getPersonaById: vi.fn(),
  getSceneById: vi.fn(),
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
  getPersonaById: mocks.getPersonaById,
  getSceneById: mocks.getSceneById,
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
    mocks.getPersonaById.mockResolvedValue({ id: 7, userId: 11, activeSceneId: null });
    mocks.getSceneById.mockResolvedValue(null);
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

  it("resolves and forwards the active scene overlay for QQ chat", async () => {
    mocks.getPersonaById.mockResolvedValue({ id: 7, userId: 11, activeSceneId: 99 });
    mocks.getSceneById.mockResolvedValue({ id: 99, systemPromptOverlay: "【此刻在一起】现在就在一起" });

    await handleQqPersonaChatDetailed("qq:private:12345", "敏子", "你在吗", {});

    expect(mocks.getSceneById).toHaveBeenCalledWith(99);
    expect(mocks.handleSocialPersonaTextChatDetailed).toHaveBeenCalledWith(expect.objectContaining({
      sceneOverlay: "【此刻在一起】现在就在一起",
    }));
  });
});
