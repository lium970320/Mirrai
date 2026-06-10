import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  llmInvoke: vi.fn(),
  createMessage: vi.fn(),
  getDefaultLlmConfig: vi.fn(),
  getPersonaById: vi.fn(),
  getReadyPersonasForProactiveMessages: vi.fn(),
  getMessagesByPersonaId: vi.fn(),
  updatePersona: vi.fn(),
  resolveProactivePreferredTarget: vi.fn(),
  sendProactiveTextToPreferredPlatform: vi.fn(),
  getCurrentLlmEconomyPolicy: vi.fn(),
}));

vi.mock("../llm", () => ({
  llmService: {
    invoke: mocks.llmInvoke,
  },
}));

vi.mock("../db", () => ({
  createMessage: mocks.createMessage,
  getDefaultLlmConfig: mocks.getDefaultLlmConfig,
  getPersonaById: mocks.getPersonaById,
  getReadyPersonasForProactiveMessages: mocks.getReadyPersonasForProactiveMessages,
  getMessagesByPersonaId: mocks.getMessagesByPersonaId,
  updatePersona: mocks.updatePersona,
}));

vi.mock("../social/proactive-delivery", () => ({
  resolveProactivePreferredTarget: mocks.resolveProactivePreferredTarget,
  sendProactiveTextToPreferredPlatform: mocks.sendProactiveTextToPreferredPlatform,
}));

vi.mock("../llm/economy", async importOriginal => {
  const actual = await importOriginal<typeof import("../llm/economy")>();
  return {
    ...actual,
    getCurrentLlmEconomyPolicy: mocks.getCurrentLlmEconomyPolicy,
  };
});

import { generateAmbientMessage, maybeSendAmbientPresenceMessage } from "./ambient-proactive";
import { generateProactiveMessage, runProactiveTick } from "./proactive-scheduler";
import { buildLlmEconomyPolicy } from "../llm/economy";

describe("proactive message generation runtime planning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDefaultLlmConfig.mockResolvedValue({
      extraConfig: { temperature: 0.7, maxTokens: 300 },
    });
    mocks.getMessagesByPersonaId.mockResolvedValue([
      { role: "assistant", content: "刚才问你吃饭了没。" },
      { role: "user", content: "还没。" },
    ]);
    mocks.resolveProactivePreferredTarget.mockResolvedValue({
      platform: "qq",
      channel: "qq",
    });
    mocks.sendProactiveTextToPreferredPlatform.mockResolvedValue({
      sent: true,
      channel: "qq",
      platform: "qq",
    });
    mocks.createMessage.mockResolvedValue(201);
    mocks.updatePersona.mockResolvedValue(undefined);
    mocks.getPersonaById.mockResolvedValue(null);
    mocks.getReadyPersonasForProactiveMessages.mockResolvedValue([]);
    mocks.llmInvoke.mockResolvedValue("我刚想到你。");
    mocks.getCurrentLlmEconomyPolicy.mockResolvedValue(buildLlmEconomyPolicy(undefined, {
      dailyLimit: 0,
      monthlyLimit: 0,
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const persona = {
    id: 7,
    userId: 11,
    name: "王芃泽",
    personaData: {
      proactiveMessages: {
        enabled: true,
        stylePrompt: "自然一点。",
      },
    },
    llmProvider: "deepseek",
  };

  it("includes proactive turn planning in scheduled proactive generation", async () => {
    await generateProactiveMessage(persona, {
      baseDate: "2026-05-18",
      baseTime: "21:00",
      actualDate: "2026-05-18",
      actualTime: "21:06",
      offsetMinutes: 6,
    });

    expect(mocks.resolveProactivePreferredTarget).toHaveBeenCalledWith(persona);
    const request = mocks.llmInvoke.mock.calls[0][0];
    expect(request.messages[0].content).toContain("【本轮内部规划】");
    expect(request.messages[0].content).toContain("入口：qq");
    expect(request.messages[0].content).toContain("本轮是主动消息");
    expect(request.messages[1].content).toContain("计划投递入口：qq / qq");
  });

  it("includes proactive turn planning in ambient proactive generation", async () => {
    await generateAmbientMessage(persona, "看了一眼聊天窗口", "evening");

    expect(mocks.resolveProactivePreferredTarget).toHaveBeenCalledWith(persona);
    const request = mocks.llmInvoke.mock.calls[0][0];
    expect(request.messages[0].content).toContain("【本轮内部规划】");
    expect(request.messages[0].content).toContain("入口：qq");
    expect(request.messages[0].content).toContain("本轮是主动消息");
    expect(request.messages[1].content).toContain("计划投递入口：qq / qq");
  });

  it("writes scheduled proactive turn diagnostics after successful delivery", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 18, 21, 6));

    const todaySlot = {
      baseDate: "2026-05-18",
      baseTime: "21:00",
      actualDate: "2026-05-18",
      actualTime: "21:06",
      offsetMinutes: 6,
    };
    mocks.getReadyPersonasForProactiveMessages.mockResolvedValue([{
      ...persona,
      emotionalState: "warm",
      personaData: {
        proactiveMessages: {
          enabled: true,
          times: ["21:00"],
          stylePrompt: "自然一点。",
        },
        personaRuntime: {
          proactiveMessages: {
            randomizedSchedule: {
              windowMinutes: 10,
              days: {
                "2026-05-17": {
                  "21:00": {
                    baseDate: "2026-05-17",
                    baseTime: "21:00",
                    actualDate: "2026-05-17",
                    actualTime: "21:06",
                    offsetMinutes: 6,
                  },
                },
                "2026-05-18": {
                  "21:00": todaySlot,
                },
              },
            },
            lastSent: {},
          },
        },
      },
    }]);

    await runProactiveTick();

    expect(mocks.createMessage).toHaveBeenCalledWith(expect.objectContaining({
      personaId: 7,
      userId: 11,
      role: "assistant",
      content: "我刚想到你。",
      channel: "qq",
    }));
    const personaUpdate = mocks.updatePersona.mock.calls.at(-1)?.[2];
    expect(personaUpdate.personaData).toMatchObject({
      personaRuntime: {
        proactiveMessages: {
          lastSent: {
            "21:00": "2026-05-18",
          },
        },
        runtimeDiagnostics: {
          platform: "qq",
          channel: "qq",
          mode: "proactive",
          trigger: "scheduled",
          inputPreview: "定时主动消息 21:00 -> 21:06",
          replyPreview: "我刚想到你。",
          delivery: {
            sent: true,
            channel: "qq",
            platform: "qq",
          },
          scheduledSlot: todaySlot,
          turnPlan: {
            platform: "qq",
            mode: "proactive",
            outputMode: "text",
          },
        },
      },
    });
  });

  it("skips scheduled proactive sends in strict economy mode", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 18, 21, 6));
    mocks.getCurrentLlmEconomyPolicy.mockResolvedValue(buildLlmEconomyPolicy({
      today: { totalTokens: 120 },
    }, {
      dailyLimit: 100,
    }));

    mocks.getReadyPersonasForProactiveMessages.mockResolvedValue([{
      ...persona,
      emotionalState: "warm",
      personaData: {
        proactiveMessages: {
          enabled: true,
          times: ["21:00"],
          stylePrompt: "自然一点。",
        },
        personaRuntime: {
          proactiveMessages: {
            randomizedSchedule: {
              windowMinutes: 10,
              days: {
                "2026-05-18": {
                  "21:00": {
                    baseDate: "2026-05-18",
                    baseTime: "21:00",
                    actualDate: "2026-05-18",
                    actualTime: "21:06",
                    offsetMinutes: 6,
                  },
                },
              },
            },
            lastSent: {},
          },
        },
      },
    }]);

    await runProactiveTick();

    expect(mocks.llmInvoke).not.toHaveBeenCalled();
    expect(mocks.sendProactiveTextToPreferredPlatform).not.toHaveBeenCalled();
    expect(mocks.createMessage).not.toHaveBeenCalled();
  });

  it("writes ambient proactive turn diagnostics after successful delivery", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 18, 20, 0));
    mocks.resolveProactivePreferredTarget.mockResolvedValue({
      platform: "wechat",
      channel: "wechat",
    });
    mocks.sendProactiveTextToPreferredPlatform.mockResolvedValue({
      sent: true,
      channel: "wechat",
      platform: "wechat",
    });
    mocks.getPersonaById.mockResolvedValue({
      ...persona,
      analysisStatus: "ready",
      emotionalState: "warm",
      personaData: {
        proactiveMessages: {
          enabled: true,
          stylePrompt: "自然一点。",
        },
        personaRuntime: {
          proactiveMessages: {
            ambientPresence: {
              date: "2026-05-18",
              counts: {
                evening: 0,
              },
              targets: {
                day: 2,
                evening: 3,
                lateNight: 0,
              },
              lastSentByPeriod: {},
            },
          },
        },
      },
    });

    const result = await maybeSendAmbientPresenceMessage(7, 11, "看了一眼聊天窗口", { force: true });

    expect(result).toMatchObject({
      sent: true,
      period: "evening",
      platform: "wechat",
    });
    expect(mocks.createMessage).toHaveBeenCalledWith(expect.objectContaining({
      personaId: 7,
      userId: 11,
      role: "assistant",
      content: "我刚想到你。",
      channel: "wechat",
    }));
    const personaUpdate = mocks.updatePersona.mock.calls.at(-1)?.[2];
    expect(personaUpdate.personaData).toMatchObject({
      personaRuntime: {
        proactiveMessages: {
          ambientPresence: {
            date: "2026-05-18",
            counts: {
              evening: 1,
            },
          },
        },
        runtimeDiagnostics: {
          platform: "wechat",
          channel: "wechat",
          mode: "proactive",
          trigger: "ambient",
          inputPreview: "环境主动消息 晚上: 看了一眼聊天窗口",
          replyPreview: "我刚想到你。",
          eventText: "看了一眼聊天窗口",
          period: "evening",
          delivery: {
            sent: true,
            channel: "wechat",
            platform: "wechat",
          },
          turnPlan: {
            platform: "wechat",
            mode: "proactive",
            outputMode: "text",
          },
        },
      },
    });
  });

  it("skips non-forced ambient proactive sends in conservative economy mode", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 18, 20, 0));
    mocks.getCurrentLlmEconomyPolicy.mockResolvedValue(buildLlmEconomyPolicy({
      today: { totalTokens: 85 },
    }, {
      dailyLimit: 100,
      warningRatio: 0.8,
    }));
    mocks.getPersonaById.mockResolvedValue({
      ...persona,
      analysisStatus: "ready",
      personaData: {
        proactiveMessages: {
          enabled: true,
          stylePrompt: "自然一点。",
        },
      },
    });

    const result = await maybeSendAmbientPresenceMessage(7, 11, "看了一眼聊天窗口");

    expect(result).toMatchObject({
      sent: false,
      reason: "llm_budget",
      period: "evening",
      economyLevel: "conservative",
    });
    expect(mocks.llmInvoke).not.toHaveBeenCalled();
    expect(mocks.sendProactiveTextToPreferredPlatform).not.toHaveBeenCalled();
  });

  it("allows forced ambient proactive sends during economy mode for manual verification", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 18, 20, 0));
    mocks.getCurrentLlmEconomyPolicy.mockResolvedValue(buildLlmEconomyPolicy({
      today: { totalTokens: 120 },
    }, {
      dailyLimit: 100,
    }));
    mocks.getPersonaById.mockResolvedValue({
      ...persona,
      analysisStatus: "ready",
      emotionalState: "warm",
      personaData: {
        proactiveMessages: {
          enabled: true,
          stylePrompt: "自然一点。",
        },
      },
    });

    const result = await maybeSendAmbientPresenceMessage(7, 11, "看了一眼聊天窗口", { force: true });

    expect(result).toMatchObject({
      sent: true,
      period: "evening",
    });
    expect(mocks.llmInvoke).toHaveBeenCalled();
  });
});
