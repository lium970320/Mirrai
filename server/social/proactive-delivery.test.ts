import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActiveQqBindingsByPersonaId: vi.fn(),
  getActiveWechatBindingsByPersonaId: vi.fn(),
  getQqBotStatus: vi.fn(),
  sendQqText: vi.fn(),
  getBotStatus: vi.fn(),
  sendWeChatText: vi.fn(),
}));

vi.mock("../db", () => ({
  getActiveQqBindingsByPersonaId: mocks.getActiveQqBindingsByPersonaId,
  getActiveWechatBindingsByPersonaId: mocks.getActiveWechatBindingsByPersonaId,
}));

vi.mock("../qq/onebot-client", () => ({
  getQqBotStatus: mocks.getQqBotStatus,
  sendQqText: mocks.sendQqText,
}));

vi.mock("../wechat/bot", () => ({
  getBotStatus: mocks.getBotStatus,
  sendWeChatText: mocks.sendWeChatText,
}));

import { resolveProactivePreferredTarget, sendProactiveTextToPreferredPlatform } from "./proactive-delivery";

describe("proactive delivery channel routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActiveQqBindingsByPersonaId.mockResolvedValue([]);
    mocks.getActiveWechatBindingsByPersonaId.mockResolvedValue([]);
    mocks.getQqBotStatus.mockResolvedValue({ status: "connected" });
    mocks.sendQqText.mockResolvedValue(true);
    mocks.getBotStatus.mockReturnValue({ status: "logged_in" });
    mocks.sendWeChatText.mockResolvedValue(true);
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
      reason: undefined,
    });
    expect(mocks.sendQqText).toHaveBeenCalledWith("qq:private:12345", "我刚想到你。");
    expect(mocks.getActiveWechatBindingsByPersonaId).not.toHaveBeenCalled();
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
      reason: "qq_offline",
    });
    expect(mocks.sendQqText).not.toHaveBeenCalled();
  });

  it("resolves the preferred proactive runtime target before delivery", async () => {
    mocks.getActiveWechatBindingsByPersonaId.mockResolvedValue([
      { wechatContactId: "wx-contact-1", wechatName: "敏子" },
    ]);

    const target = await resolveProactivePreferredTarget({ id: 7, userId: 11 });

    expect(target).toMatchObject({
      channel: "wechat",
      platform: "wechat",
      qqBindings: [],
      wechatBindings: [
        { wechatContactId: "wx-contact-1", wechatName: "敏子" },
      ],
    });
  });

  it("falls back to the web channel when no proactive external binding exists", async () => {
    const target = await resolveProactivePreferredTarget({ id: 7, userId: 11 });

    expect(target).toMatchObject({
      channel: "web",
      platform: null,
      qqBindings: [],
      wechatBindings: [],
    });
  });
});
