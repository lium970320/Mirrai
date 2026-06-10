import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActiveQqBindingsByPersonaId: vi.fn(),
  getQqBotStatus: vi.fn(),
  sendQqText: vi.fn(),
}));

vi.mock("../db", () => ({
  getActiveQqBindingsByPersonaId: mocks.getActiveQqBindingsByPersonaId,
}));

vi.mock("../qq/onebot-client", () => ({
  getQqBotStatus: mocks.getQqBotStatus,
  sendQqText: mocks.sendQqText,
}));

import { resolveProactivePreferredTarget, sendProactiveTextToPreferredPlatform } from "./proactive-delivery";

describe("proactive delivery channel routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActiveQqBindingsByPersonaId.mockResolvedValue([]);
    mocks.getQqBotStatus.mockResolvedValue({ status: "connected" });
    mocks.sendQqText.mockResolvedValue(true);
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
    mocks.getActiveQqBindingsByPersonaId.mockResolvedValue([
      { wechatContactId: "qq:private:12345" },
    ]);

    const target = await resolveProactivePreferredTarget({ id: 7, userId: 11 });

    expect(target).toMatchObject({
      channel: "qq",
      platform: "qq",
      qqBindings: [{ wechatContactId: "qq:private:12345" }],
      wechatBindings: [],
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
