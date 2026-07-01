import { afterEach, describe, expect, it } from "vitest";
import {
  buildLlmTurnEconomyPolicy,
  buildLlmEconomyPolicy,
  getLlmBudgetDiagnostics,
  setLlmEconomyPolicyOverrideForTests,
} from "./economy";

describe("LLM economy policy", () => {
  afterEach(() => {
    setLlmEconomyPolicyOverrideForTests(null);
  });

  it("keeps economy mode off when no soft budget is configured", () => {
    const policy = buildLlmEconomyPolicy(undefined, {
      dailyLimit: 0,
      monthlyLimit: 0,
    });

    expect(policy.level).toBe("off");
    expect(policy.enabled).toBe(false);
    expect(policy.voice.allowSmartJudge).toBe(true);
    expect(policy.proactive.allowAmbient).toBe(true);
  });

  it("enters conservative mode near the soft budget and trims optional LLM enrichments", () => {
    const policy = buildLlmEconomyPolicy({
      today: { totalTokens: 85 },
      month: { totalTokens: 120 },
    }, {
      dailyLimit: 100,
      monthlyLimit: 1000,
      warningRatio: 0.8,
    });

    expect(policy.level).toBe("conservative");
    expect(policy.voice.allowSmartJudge).toBe(true);
    expect(policy.voice.allowNonExplicitVoice).toBe(true);
    expect(policy.tts.allowLlmSpeechEnrichment).toBe(false);
    expect(policy.proactive.allowScheduled).toBe(true);
    expect(policy.proactive.allowAmbient).toBe(false);
    expect(policy.context.llmHistoryLimit).toBe(14);
    expect(policy.memoryRecall).toMatchObject({ maxMemories: 3, maxDescriptionChars: 180 });
    expect(policy.sourceRecall.maxChunks).toBe(6);
    expect(policy.sourceRecall.maxExcerptChars).toBe(620);
    expect(policy.sourceRecall.maxRewriteTokens).toBe(400);
    expect(policy.limitsSummary).toMatchObject({
      mode: "conservative",
      context: {
        historyFetchLimit: 16,
        llmHistoryLimit: 14,
      },
      memoryRecall: {
        maxMemories: 3,
        maxDescriptionChars: 180,
      },
      sourceRecall: {
        maxChunks: 6,
        maxExcerptChars: 620,
        maxRewriteTokens: 400,
      },
      routeSpecific: {
        active: false,
        profile: "default",
      },
    });
    expect(policy.limitsSummary.safeguards.join("\n")).toContain("每轮保护上限");
  });

  it("enters strict mode after exceeding a soft budget", () => {
    const diagnostics = getLlmBudgetDiagnostics({
      today: { totalTokens: 120 },
      month: { totalTokens: 200 },
    }, {
      dailyLimit: 100,
      monthlyLimit: 1000,
      warningRatio: 0.8,
    });
    const policy = buildLlmEconomyPolicy({
      today: { totalTokens: 120 },
      month: { totalTokens: 200 },
    }, {
      dailyLimit: 100,
      monthlyLimit: 1000,
      warningRatio: 0.8,
    });

    expect(diagnostics.status).toBe("exceeded");
    expect(policy.level).toBe("strict");
    expect(policy.voice.allowSmartJudge).toBe(false);
    expect(policy.voice.allowNonExplicitVoice).toBe(false);
    expect(policy.tts.allowLlmSpeechEnrichment).toBe(false);
    expect(policy.proactive.allowScheduled).toBe(false);
    expect(policy.proactive.allowAmbient).toBe(false);
    expect(policy.context).toMatchObject({
      historyFetchLimit: 12,
      llmHistoryLimit: 10,
      recallRecentLimit: 4,
    });
    expect(policy.memoryRecall).toMatchObject({ maxMemories: 2, maxDescriptionChars: 140 });
    expect(policy.sourceRecall.maxChunks).toBe(4);
    expect(policy.sourceRecall.maxExcerptChars).toBe(480);
    expect(policy.sourceRecall.maxRewriteTokens).toBe(320);
    expect(policy.limitsSummary.tuningAdvice).toContain("严格模式");
  });

  it("applies route and intent specific recall degradation for high-frequency QQ chat", () => {
    const base = buildLlmEconomyPolicy(undefined, {
      dailyLimit: 0,
      monthlyLimit: 0,
    });
    const policy = buildLlmTurnEconomyPolicy(base, {
      route: "social.qq.text_reply",
      platform: "qq",
      intent: "daily_chat",
    });

    expect(policy.level).toBe("off");
    expect(policy.recallDegradation.profile).toBe("high_frequency_chat");
    expect(policy.context).toMatchObject({
      historyFetchLimit: 20,
      llmHistoryLimit: 14,
      continuityRecentLimit: 10,
      continuityTimelineLimit: 8,
      recallRecentLimit: 4,
    });
    expect(policy.memoryRecall).toEqual({ maxMemories: 2, maxDescriptionChars: 140 });
    expect(policy.sourceRecall).toMatchObject({ maxChunks: 2, maxExcerptChars: 360, maxRewriteTokens: 260 });
    expect(policy.limitsSummary).toMatchObject({
      routeSpecific: {
        active: true,
        profile: "high_frequency_chat",
      },
      context: {
        historyFetchLimit: 20,
        llmHistoryLimit: 14,
      },
      sourceRecall: {
        maxChunks: 2,
        maxRewriteTokens: 260,
      },
    });
    expect(policy.limitsSummary.routeSpecific.reasons.join("\n")).toContain("高频入口");
  });

  it("keeps source evidence guarded while suppressing relationship memory pollution", () => {
    const base = buildLlmEconomyPolicy({
      today: { totalTokens: 85 },
      month: { totalTokens: 120 },
    }, {
      dailyLimit: 100,
      monthlyLimit: 1000,
      warningRatio: 0.8,
    });
    const policy = buildLlmTurnEconomyPolicy(base, {
      route: "social.web.text_reply",
      platform: "web",
      intent: "source_recall",
      sourceRecallActive: true,
    });

    expect(policy.level).toBe("conservative");
    expect(policy.recallDegradation.profile).toBe("source_guarded");
    expect(policy.memoryRecall).toEqual({ maxMemories: 1, maxDescriptionChars: 120 });
    expect(policy.sourceRecall).toEqual({ maxChunks: 6, maxExcerptChars: 620, maxRewriteTokens: 400 });
    expect(policy.context.recallRecentLimit).toBe(4);
  });

  it("uses minimal recall for proactive routes", () => {
    const base = buildLlmEconomyPolicy(undefined, {
      dailyLimit: 0,
      monthlyLimit: 0,
    });
    const policy = buildLlmTurnEconomyPolicy(base, {
      route: "proactive.qq.scheduled",
      platform: "qq",
      intent: "daily_chat",
    });

    expect(policy.recallDegradation.profile).toBe("proactive_minimal");
    expect(policy.context.historyFetchLimit).toBe(8);
    expect(policy.context.llmHistoryLimit).toBe(6);
    expect(policy.memoryRecall.maxMemories).toBe(1);
    expect(policy.sourceRecall.maxChunks).toBe(2);
  });
});
