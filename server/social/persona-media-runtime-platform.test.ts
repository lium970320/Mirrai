import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  llmInvoke: vi.fn(),
  getPersonaById: vi.fn(),
  createMessage: vi.fn(),
  getMessagesByPersonaId: vi.fn(),
  updatePersona: vi.fn(),
  getDefaultLlmConfig: vi.fn(),
  storagePut: vi.fn(),
  describeImage: vi.fn(),
  buildPersonaMemoryRecallContext: vi.fn(),
  getCurrentLlmEconomyPolicy: vi.fn(),
}));

vi.mock("../llm", () => ({
  llmService: {
    invoke: mocks.llmInvoke,
  },
}));

vi.mock("../llm/economy", async () => {
  const actual = await vi.importActual<typeof import("../llm/economy")>("../llm/economy");
  return {
    ...actual,
    getCurrentLlmEconomyPolicy: mocks.getCurrentLlmEconomyPolicy,
  };
});

vi.mock("../db", () => ({
  getPersonaById: mocks.getPersonaById,
  createMessage: mocks.createMessage,
  getMessagesByPersonaId: mocks.getMessagesByPersonaId,
  updatePersona: mocks.updatePersona,
  getDefaultLlmConfig: mocks.getDefaultLlmConfig,
}));

vi.mock("../storage", () => ({
  storagePut: mocks.storagePut,
}));

vi.mock("../vision", () => ({
  describeImage: mocks.describeImage,
}));

vi.mock("./memory-recall", () => ({
  buildPersonaMemoryRecallContext: mocks.buildPersonaMemoryRecallContext,
}));

vi.mock("nanoid", () => ({
  nanoid: () => "media-id",
}));

import { handleSocialPersonaMediaChatDetailed } from "./persona-media-chat";
import { defaultOutputPreferenceForPlatform } from "./runtime-request";

describe("shared social media runtime platform routing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 18, 20, 0));
    vi.clearAllMocks();
    mocks.getPersonaById.mockResolvedValue({
      id: 7,
      userId: 11,
      name: "王芃泽",
      relationshipDesc: "恋人",
      emotionalState: "warm",
      analysisStatus: "ready",
      chatCount: 3,
      personaData: {
        profileSections: {
          personality: { traits: "克制、温柔、成熟" },
          speaking: { style: "短句、自然、像私聊" },
          relationship: {
            feelingsForUser: "很在乎敏子",
            boundaries: "承认武汉和南京异地",
          },
        },
      },
      llmProvider: "deepseek",
    });
    mocks.storagePut.mockResolvedValue({ url: "https://cdn.example/media.png" });
    mocks.describeImage.mockResolvedValue("画面里是一杯热茶和一盏台灯。");
    mocks.createMessage
      .mockResolvedValueOnce(101)
      .mockResolvedValueOnce(102);
    mocks.getMessagesByPersonaId.mockResolvedValue([
      { id: 90, role: "assistant", content: "刚才问你吃饭了没。" },
      { id: 101, role: "user", content: "[图片]\n画面里是一杯热茶和一盏台灯。" },
    ]);
    mocks.getDefaultLlmConfig.mockResolvedValue({
      extraConfig: { temperature: 0.72, maxTokens: 320 },
    });
    mocks.buildPersonaMemoryRecallContext.mockResolvedValue("【长期关系记忆】\n1. 敏子喜欢夜里发图片接话。");
    mocks.llmInvoke.mockResolvedValue("这杯茶看着挺暖的。");
    mocks.getCurrentLlmEconomyPolicy.mockResolvedValue({
      enabled: false,
      level: "off",
      budget: {
        enabled: false,
        status: "disabled",
        warningRatio: 0.8,
        daily: { limit: 0, used: 0, remaining: null, status: "disabled" },
        monthly: { limit: 0, used: 0, remaining: null, status: "disabled" },
        recommendation: "未配置软额度。",
      },
      context: {
        historyFetchLimit: 20,
        llmHistoryLimit: 19,
        continuityRecentLimit: 12,
        continuityTimelineLimit: 10,
        reflectionRecentLimit: 12,
        recallRecentLimit: 8,
        consolidationRecentLimit: 12,
      },
      voice: { allowSmartJudge: true, allowNonExplicitVoice: true },
      tts: { allowLlmSpeechEnrichment: true },
      proactive: { allowScheduled: true, allowAmbient: true },
      memoryRecall: { maxMemories: 4, maxDescriptionChars: 220 },
      sourceRecall: { maxChunks: 9, maxExcerptChars: 760, maxRewriteTokens: 480 },
      recommendation: "省额度模式未启用。",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function runPlatform(input: {
    platform: "web" | "wechat" | "qq";
    storagePrefix: string;
    kind: "image" | "emoticon";
    fileName: string;
    caption?: string;
  }) {
    return handleSocialPersonaMediaChatDetailed({
      platform: input.platform,
      channel: input.platform,
      binding: { personaId: 7, userId: 11 },
      contactName: "敏子",
      storagePrefix: input.storagePrefix,
      outputPreference: defaultOutputPreferenceForPlatform(input.platform),
      media: {
        kind: input.kind,
        buffer: Buffer.from("image-bytes"),
        fileName: input.fileName,
        mimeType: "image/png",
        caption: input.caption,
      },
    });
  }

  it("uses the same media runtime for web, WeChat and QQ while preserving platform media contracts", async () => {
    const cases = [
      { platform: "web" as const, label: "网页", mediaLabel: "网页图片", storagePrefix: "chat", kind: "image" as const, fileName: "web.png" },
      { platform: "wechat" as const, label: "微信", mediaLabel: "微信图片", storagePrefix: "wechat", kind: "image" as const, fileName: "wx.png" },
      { platform: "qq" as const, label: "QQ", mediaLabel: "QQ表情包", storagePrefix: "qq", kind: "emoticon" as const, fileName: "qq.png", caption: "嘿嘿" },
    ];

    for (const item of cases) {
      vi.clearAllMocks();
      mocks.getPersonaById.mockResolvedValue({
        id: 7,
        userId: 11,
        name: "王芃泽",
        relationshipDesc: "恋人",
        emotionalState: "warm",
        analysisStatus: "ready",
        chatCount: 3,
        personaData: {
          profileSections: {
            personality: { traits: "克制、温柔、成熟" },
            speaking: { style: "短句、自然、像私聊" },
            relationship: {
              feelingsForUser: "很在乎敏子",
              boundaries: "承认武汉和南京异地",
            },
          },
        },
        llmProvider: "deepseek",
      });
      mocks.storagePut.mockResolvedValue({ url: "https://cdn.example/media.png" });
      mocks.describeImage.mockResolvedValue("画面里是一杯热茶和一盏台灯。");
      mocks.createMessage
        .mockResolvedValueOnce(101)
        .mockResolvedValueOnce(102);
      mocks.getMessagesByPersonaId.mockResolvedValue([
        { id: 90, role: "assistant", content: "刚才问你吃饭了没。" },
        { id: 101, role: "user", content: "[图片]\n画面里是一杯热茶和一盏台灯。" },
      ]);
      mocks.getDefaultLlmConfig.mockResolvedValue({
        extraConfig: { temperature: 0.72, maxTokens: 320 },
      });
      mocks.buildPersonaMemoryRecallContext.mockResolvedValue("【长期关系记忆】\n1. 敏子喜欢夜里发图片接话。");
      mocks.llmInvoke.mockResolvedValue("这杯茶看着挺暖的。");
      mocks.getCurrentLlmEconomyPolicy.mockResolvedValue({
        enabled: false,
        level: "off",
        budget: {
          enabled: false,
          status: "disabled",
          warningRatio: 0.8,
          daily: { limit: 0, used: 0, remaining: null, status: "disabled" },
          monthly: { limit: 0, used: 0, remaining: null, status: "disabled" },
          recommendation: "未配置软额度。",
        },
        context: {
          historyFetchLimit: 20,
          llmHistoryLimit: 19,
          continuityRecentLimit: 12,
          continuityTimelineLimit: 10,
          reflectionRecentLimit: 12,
          recallRecentLimit: 8,
          consolidationRecentLimit: 12,
        },
        voice: { allowSmartJudge: true, allowNonExplicitVoice: true },
        tts: { allowLlmSpeechEnrichment: true },
        proactive: { allowScheduled: true, allowAmbient: true },
        memoryRecall: { maxMemories: 4, maxDescriptionChars: 220 },
        sourceRecall: { maxChunks: 9, maxExcerptChars: 760, maxRewriteTokens: 480 },
        recommendation: "省额度模式未启用。",
      });

      const result = await runPlatform(item);

      expect(result).toMatchObject({
        replyText: "这杯茶看着挺暖的。",
        emotionalState: expect.any(String),
        mediaUrl: "https://cdn.example/media.png",
      });
      expect(mocks.storagePut).toHaveBeenCalledWith(
        expect.stringContaining(`${item.storagePrefix}/11/7/media-id-${item.fileName}`),
        expect.any(Buffer),
        "image/png",
      );
      expect(mocks.createMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({
        role: "user",
        messageType: "image",
        mediaUrl: "https://cdn.example/media.png",
        channel: item.platform,
      }));
      expect(mocks.createMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({
        role: "assistant",
        channel: item.platform,
      }));

      const llmRequest = mocks.llmInvoke.mock.calls[0][0];
      expect(llmRequest.messages[0].content).toContain(`【${item.label} 接入规则】`);
      expect(llmRequest.messages[0].content).toContain("同一套人物设定");
      expect(llmRequest.messages[0].content).toContain("【本轮内部规划】");
      expect(llmRequest.messages[0].content).toContain("意图：media");
      expect(llmRequest.messages[0].content).toContain("输出倾向：media_reply");
      expect(llmRequest.messages[0].content).toContain("【长期关系记忆】");

      const currentUserInstruction = llmRequest.messages.find((message: { role: string; content: string }) =>
        message.role === "user" && message.content.includes(item.mediaLabel)
      );
      expect(currentUserInstruction?.content).toContain(item.mediaLabel);
      expect(currentUserInstruction?.content).toContain("画面里是一杯热茶和一盏台灯。");
      if (item.caption) {
        expect(currentUserInstruction?.content).toContain(`对方随图附带文字：${item.caption}`);
      }

      const personaUpdate = mocks.updatePersona.mock.calls.at(-1)?.[2];
      expect(personaUpdate.personaData).toMatchObject({
        personaRuntime: {
          runtimeDiagnostics: {
            platform: item.platform,
            channel: item.platform,
            mode: "reply",
            mediaKind: item.kind,
            mediaUrl: "https://cdn.example/media.png",
            memoryRecallUsed: true,
            visionUsed: true,
            economy: {
              recallDegradation: {
                profile: "media_light",
              },
            },
            turnPlan: {
              platform: item.platform,
              mode: "reply",
              intent: "media",
              outputMode: "media_reply",
            },
          },
        },
      });
    }
  });

  it("applies media-light recall limits before building media replies", async () => {
    await runPlatform({
      platform: "qq",
      storagePrefix: "qq",
      kind: "emoticon",
      fileName: "qq.png",
      caption: "嘿嘿",
    });

    expect(mocks.getMessagesByPersonaId).toHaveBeenCalledWith(7, 10);
    expect(mocks.buildPersonaMemoryRecallContext).toHaveBeenCalledWith(expect.objectContaining({
      limit: 2,
      maxDescriptionChars: 140,
    }));
    const llmRequest = mocks.llmInvoke.mock.calls[0][0];
    const nonSystemMessages = llmRequest.messages.filter((message: { role: string }) => message.role !== "system");
    expect(nonSystemMessages.length).toBeLessThanOrEqual(8);
    expect(mocks.updatePersona).toHaveBeenCalledWith(7, 11, expect.objectContaining({
      personaData: expect.objectContaining({
        personaRuntime: expect.objectContaining({
          runtimeDiagnostics: expect.objectContaining({
            economy: expect.objectContaining({
              context: expect.objectContaining({
                historyFetchLimit: 10,
                llmHistoryLimit: 8,
                recallRecentLimit: 4,
              }),
              memoryRecall: { maxMemories: 2, maxDescriptionChars: 140 },
              recallDegradation: expect.objectContaining({ profile: "media_light" }),
            }),
          }),
        }),
      }),
    }));
  });
});
