import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  llmInvoke: vi.fn(),
  getPersonaById: vi.fn(),
  createMessage: vi.fn(),
  getMessagesByPersonaId: vi.fn(),
  updatePersona: vi.fn(),
  getDefaultLlmConfig: vi.fn(),
  buildPersonaSourceRecallContext: vi.fn(),
  buildPersonaMemoryRecallContext: vi.fn(),
  buildPersonaReflection: vi.fn(),
  consolidateMemoryAfterTurn: vi.fn(),
  enforceSourceGroundedReply: vi.fn(),
  detectVoiceRequestDecision: vi.fn(),
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

vi.mock("./source-recall", () => ({
  buildPersonaSourceRecallContext: mocks.buildPersonaSourceRecallContext,
}));

vi.mock("./memory-recall", () => ({
  buildPersonaMemoryRecallContext: mocks.buildPersonaMemoryRecallContext,
}));

vi.mock("./persona-reflection", async () => {
  const actual = await vi.importActual<typeof import("./persona-reflection")>("./persona-reflection");
  return {
    ...actual,
    buildPersonaReflection: mocks.buildPersonaReflection,
  };
});

vi.mock("./memory-consolidation", () => ({
  consolidateMemoryAfterTurn: mocks.consolidateMemoryAfterTurn,
}));

vi.mock("./source-grounding", async () => {
  const actual = await vi.importActual<typeof import("./source-grounding")>("./source-grounding");
  return {
    ...actual,
    enforceSourceGroundedReply: mocks.enforceSourceGroundedReply,
  };
});

vi.mock("../voice/voice-reply-policy", async () => {
  const actual = await vi.importActual<typeof import("../voice/voice-reply-policy")>("../voice/voice-reply-policy");
  return {
    ...actual,
    detectVoiceRequestDecision: mocks.detectVoiceRequestDecision,
  };
});

import { handleSocialPersonaTextChatDetailed } from "./persona-text-chat";
import { defaultOutputPreferenceForPlatform } from "./runtime-request";

describe("shared social text runtime platform routing", () => {
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
    mocks.createMessage
      .mockResolvedValueOnce(101)
      .mockResolvedValueOnce(102);
    mocks.getMessagesByPersonaId.mockResolvedValue([
      { id: 90, role: "assistant", content: "刚才问你吃饭了没。" },
      { id: 101, role: "user", content: "你在吗" },
    ]);
    mocks.getDefaultLlmConfig.mockResolvedValue({
      extraConfig: { temperature: 0.72, maxTokens: 320 },
    });
    mocks.buildPersonaSourceRecallContext.mockResolvedValue("");
    mocks.buildPersonaMemoryRecallContext.mockResolvedValue("【长期关系记忆】\n1. 敏子在武汉上课，王芃泽在南京工作。");
    mocks.buildPersonaReflection.mockResolvedValue({
      intent: "daily_chat",
      shouldRecallMemory: true,
      memoryQueries: ["异地", "日常"],
      shouldRecordMemory: false,
      recordReason: "",
      innerReaction: "他是在确认你有没有陪着。",
      replyStrategy: "短句接住，别展开太多。",
      replyLength: "short",
      outputMode: "text",
      risks: ["none"],
      avoid: ["不要重新介绍关系"],
      mood: "温和",
    });
    mocks.consolidateMemoryAfterTurn.mockResolvedValue({
      status: "skipped_low_signal",
      reason: "测试跳过",
      attempted: false,
      createdMemoryIds: [],
      skippedDuplicateIds: [],
      archivedMemoryIds: [],
      contradictedMemoryIds: [],
      cards: [],
      decisions: [],
    });
    mocks.detectVoiceRequestDecision.mockResolvedValue({
      explicitVoiceRequest: false,
      confidence: 0.7,
      reason: "test_no_voice",
    });
    mocks.enforceSourceGroundedReply.mockImplementation(async (input: { draftReply: string }) => input.draftReply);
    mocks.llmInvoke.mockResolvedValue("我在，刚看见。");
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

  async function runPlatform(platform: "web" | "wechat" | "qq") {
    return handleSocialPersonaTextChatDetailed({
      platform,
      channel: platform,
      binding: { personaId: 7, userId: 11 },
      contactName: "敏子",
      messageText: "你在吗",
      outputPreference: defaultOutputPreferenceForPlatform(platform),
    });
  }

  it("uses the same runtime pipeline for web, WeChat and QQ while preserving platform contracts", async () => {
    const cases = [
      { platform: "web" as const, label: "网页", voiceReason: "voice_output_disabled_by_platform" },
      { platform: "wechat" as const, label: "微信", voiceReason: "voice_output_disabled_by_platform" },
      { platform: "qq" as const, label: "QQ", voiceReason: "test_no_voice" },
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
      mocks.createMessage
        .mockResolvedValueOnce(101)
        .mockResolvedValueOnce(102);
      mocks.getMessagesByPersonaId.mockResolvedValue([
        { id: 90, role: "assistant", content: "刚才问你吃饭了没。" },
        { id: 101, role: "user", content: "你在吗" },
      ]);
      mocks.getDefaultLlmConfig.mockResolvedValue({
        extraConfig: { temperature: 0.72, maxTokens: 320 },
      });
      mocks.buildPersonaSourceRecallContext.mockResolvedValue("");
      mocks.buildPersonaMemoryRecallContext.mockResolvedValue("【长期关系记忆】\n1. 敏子在武汉上课，王芃泽在南京工作。");
      mocks.buildPersonaReflection.mockResolvedValue({
        intent: "daily_chat",
        shouldRecallMemory: true,
        memoryQueries: ["异地", "日常"],
        shouldRecordMemory: false,
        recordReason: "",
        innerReaction: "他是在确认你有没有陪着。",
        replyStrategy: "短句接住，别展开太多。",
        replyLength: "short",
        outputMode: "text",
        risks: ["none"],
        avoid: ["不要重新介绍关系"],
        mood: "温和",
      });
      mocks.consolidateMemoryAfterTurn.mockResolvedValue({
        status: "skipped_low_signal",
        reason: "测试跳过",
        attempted: false,
        createdMemoryIds: [],
        skippedDuplicateIds: [],
        archivedMemoryIds: [],
        contradictedMemoryIds: [],
        cards: [],
        decisions: [],
      });
      mocks.detectVoiceRequestDecision.mockResolvedValue({
        explicitVoiceRequest: false,
        confidence: 0.7,
        reason: "test_no_voice",
      });
      mocks.enforceSourceGroundedReply.mockImplementation(async (input: { draftReply: string }) => input.draftReply);
      mocks.llmInvoke.mockResolvedValue("我在，刚看见。");
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

      const result = await runPlatform(item.platform);

      expect(result?.replyText).toBe("我在，刚看见。");
      expect(result?.turnPlan).toMatchObject({
        platform: item.platform,
        mode: "reply",
        intent: "daily_chat",
        outputMode: "text",
      });
      expect(result?.voiceRequestDecision.reason).toBe(item.voiceReason);

      expect(mocks.createMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({
        role: "user",
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
      expect(llmRequest.messages[0].content).toContain("【长期关系记忆】");
      const currentUserInstruction = llmRequest.messages.find((message: { role: string; content: string }) =>
        message.role === "user" && message.content.includes("【平台一致性】")
      );
      expect(currentUserInstruction?.content).toContain(`【平台一致性】这只是${item.label}入口`);
      expect(mocks.updatePersona).toHaveBeenCalledWith(7, 11, expect.objectContaining({
        personaData: expect.objectContaining({
          personaRuntime: expect.objectContaining({
            runtimeDiagnostics: expect.objectContaining({
              platform: item.platform,
              channel: item.platform,
              mode: "reply",
              turnPlan: expect.objectContaining({ platform: item.platform }),
              memoryRecallUsed: true,
              economy: expect.objectContaining({
                recallDegradation: expect.objectContaining({
                  profile: item.platform === "qq" || item.platform === "wechat" ? "high_frequency_chat" : "default",
                }),
              }),
            }),
          }),
        }),
      }));
    }
  });

  it("applies economy limits to history and recall inputs", async () => {
    mocks.getCurrentLlmEconomyPolicy.mockResolvedValue({
      enabled: true,
      level: "strict",
      budget: {
        enabled: true,
        status: "exceeded",
        warningRatio: 0.8,
        daily: { limit: 100, used: 120, remaining: 0, status: "exceeded" },
        monthly: { limit: 1000, used: 120, remaining: 880, status: "ok" },
        recommendation: "已超过软额度。",
      },
      context: {
        historyFetchLimit: 12,
        llmHistoryLimit: 3,
        continuityRecentLimit: 4,
        continuityTimelineLimit: 3,
        reflectionRecentLimit: 5,
        recallRecentLimit: 2,
        consolidationRecentLimit: 4,
      },
      voice: { allowSmartJudge: false, allowNonExplicitVoice: false },
      tts: { allowLlmSpeechEnrichment: false },
      proactive: { allowScheduled: false, allowAmbient: false },
      memoryRecall: { maxMemories: 2, maxDescriptionChars: 140 },
      sourceRecall: { maxChunks: 4, maxExcerptChars: 480, maxRewriteTokens: 320 },
      recommendation: "严格省额度。",
    });
    mocks.getMessagesByPersonaId.mockResolvedValue([
      { id: 1, role: "user", content: "旧 1" },
      { id: 2, role: "assistant", content: "旧 2" },
      { id: 3, role: "user", content: "旧 3" },
      { id: 4, role: "assistant", content: "旧 4" },
      { id: 5, role: "user", content: "你在吗" },
    ]);

    await runPlatform("qq");

    expect(mocks.getMessagesByPersonaId).toHaveBeenCalledWith(7, 12);
    expect(mocks.buildPersonaSourceRecallContext).toHaveBeenCalledWith(expect.objectContaining({
      recentMessages: [
        { id: 4, role: "assistant", content: "旧 4" },
        { id: 5, role: "user", content: "你在吗" },
      ],
      limit: 4,
      maxExcerptChars: 480,
    }));
    expect(mocks.buildPersonaMemoryRecallContext).toHaveBeenCalledWith(expect.objectContaining({
      recentMessages: [
        { id: 4, role: "assistant", content: "旧 4" },
        { id: 5, role: "user", content: "你在吗" },
      ],
      limit: 2,
      maxDescriptionChars: 140,
    }));

    const llmRequest = mocks.llmInvoke.mock.calls[0][0];
    const nonSystemMessages = llmRequest.messages.filter((message: { role: string }) => message.role !== "system");
    expect(nonSystemMessages).toHaveLength(3);
    expect(nonSystemMessages[0].content).toBe("旧 3");
    expect(llmRequest.messages[0].content).toContain("最近对话时间线");
    expect(mocks.updatePersona).toHaveBeenCalledWith(7, 11, expect.objectContaining({
      personaData: expect.objectContaining({
        personaRuntime: expect.objectContaining({
          runtimeDiagnostics: expect.objectContaining({
            economy: expect.objectContaining({
              level: "strict",
              memoryRecall: { maxMemories: 2, maxDescriptionChars: 140 },
              sourceRecall: { maxChunks: 2, maxExcerptChars: 360, maxRewriteTokens: 260 },
              recallDegradation: expect.objectContaining({ profile: "high_frequency_chat" }),
            }),
          }),
        }),
      }),
    }));
  });

  it("uses source-guarded recall limits for source questions on QQ", async () => {
    mocks.buildPersonaSourceRecallContext.mockResolvedValue("【原著资料库检索：内部证据】\n证据 1：老鹰峡");
    mocks.getMessagesByPersonaId.mockResolvedValue([
      { id: 1, role: "user", content: "旧 1" },
      { id: 2, role: "assistant", content: "旧 2" },
      { id: 3, role: "user", content: "旧 3" },
      { id: 4, role: "assistant", content: "旧 4" },
      { id: 5, role: "user", content: "叔，你还记得老鹰峡那次吗" },
    ]);
    mocks.llmInvoke.mockResolvedValue("那段我记得，不能乱说。");

    await handleSocialPersonaTextChatDetailed({
      platform: "qq",
      channel: "qq",
      binding: { personaId: 7, userId: 11 },
      contactName: "敏子",
      messageText: "叔，你还记得老鹰峡那次吗",
      outputPreference: defaultOutputPreferenceForPlatform("qq"),
    });

    expect(mocks.buildPersonaSourceRecallContext).toHaveBeenCalledWith(expect.objectContaining({
      recentMessages: [
        { id: 2, role: "assistant", content: "旧 2" },
        { id: 3, role: "user", content: "旧 3" },
        { id: 4, role: "assistant", content: "旧 4" },
        { id: 5, role: "user", content: "叔，你还记得老鹰峡那次吗" },
      ],
      limit: 5,
      maxExcerptChars: 680,
    }));
    expect(mocks.buildPersonaMemoryRecallContext).toHaveBeenCalledWith(expect.objectContaining({
      limit: 1,
      maxDescriptionChars: 120,
    }));
    expect(mocks.updatePersona).toHaveBeenCalledWith(7, 11, expect.objectContaining({
      personaData: expect.objectContaining({
        personaRuntime: expect.objectContaining({
          runtimeDiagnostics: expect.objectContaining({
            sourceRecallUsed: true,
            economy: expect.objectContaining({
              recallDegradation: expect.objectContaining({ profile: "source_guarded" }),
              memoryRecall: { maxMemories: 1, maxDescriptionChars: 120 },
              sourceRecall: { maxChunks: 5, maxExcerptChars: 680, maxRewriteTokens: 480 },
            }),
          }),
        }),
      }),
    }));
  });
});
