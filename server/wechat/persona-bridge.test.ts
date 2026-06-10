import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getWechatBindingByContactId: vi.fn(),
  handleSocialPersonaTextChat: vi.fn(),
  handleSocialPersonaMediaChat: vi.fn(),
}));

vi.mock("../db", () => ({
  getWechatBindingByContactId: mocks.getWechatBindingByContactId,
}));

vi.mock("../social/persona-text-chat", () => ({
  handleSocialPersonaTextChat: mocks.handleSocialPersonaTextChat,
}));

vi.mock("../social/persona-media-chat", () => ({
  handleSocialPersonaMediaChat: mocks.handleSocialPersonaMediaChat,
}));

import { handlePersonaChat, handlePersonaMediaChat } from "./persona-bridge";

describe("WeChat persona bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getWechatBindingByContactId.mockResolvedValue({
      personaId: 7,
      userId: 11,
    });
    mocks.handleSocialPersonaTextChat.mockResolvedValue("我在。");
    mocks.handleSocialPersonaMediaChat.mockResolvedValue("看到了。");
  });

  it("passes WeChat text messages into the shared runtime with WeChat output capabilities", async () => {
    await handlePersonaChat("wx-contact-1", "敏子", "你在吗", {
      batchMessageCount: 1,
      batchMessages: ["你在吗"],
    });

    expect(mocks.handleSocialPersonaTextChat).toHaveBeenCalledWith(expect.objectContaining({
      platform: "wechat",
      channel: "wechat",
      outputPreference: {
        allowText: true,
        allowVoice: false,
        allowStickers: false,
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

  it("passes WeChat media messages into the shared runtime with WeChat output capabilities", async () => {
    await handlePersonaMediaChat("wx-contact-1", "敏子", {
      kind: "image",
      buffer: Buffer.from("png"),
      fileName: "a.png",
      mimeType: "image/png",
    });

    expect(mocks.handleSocialPersonaMediaChat).toHaveBeenCalledWith(expect.objectContaining({
      platform: "wechat",
      channel: "wechat",
      outputPreference: {
        allowText: true,
        allowVoice: false,
        allowStickers: false,
        allowProactive: true,
      },
      contactName: "敏子",
      storagePrefix: "wechat",
      binding: {
        personaId: 7,
        userId: 11,
      },
    }));
  });
});
