import { beforeEach, describe, expect, it } from "vitest";
import {
  estimateLlmInput,
  estimateLlmOutput,
  getLlmUsageDetails,
  getLlmUsageSnapshot,
  recordLlmUsage,
  resetLlmUsageForTests,
  setLlmUsagePersistentRecorder,
} from "./usage";

describe("LLM usage tracking", () => {
  beforeEach(() => {
    setLlmUsagePersistentRecorder(null);
    resetLlmUsageForTests();
  });

  it("estimates text and image input sizes consistently", () => {
    const estimate = estimateLlmInput([
      { role: "system", content: "hello" },
      {
        role: "user",
        content: [
          { type: "text", text: "abc" },
          { type: "image_url", url: "https://example.test/a.png" },
        ],
      },
    ]);

    expect(estimate.chars).toBe(428);
    expect(estimate.tokens).toBe(252);
    expect(estimateLlmOutput("abcd")).toEqual({ chars: 4, tokens: 3 });
    expect(estimateLlmOutput("")).toEqual({ chars: 0, tokens: 0 });
  });

  it("aggregates today's successful and failed calls by provider and purpose", () => {
    recordLlmUsage({
      startedAt: "2026-06-07T23:59:00.000Z",
      durationMs: 100,
      provider: "OpenAI",
      requestedProvider: "openai",
      model: "gpt-test",
      purpose: "chat",
      success: true,
      inputTokens: 10,
      outputTokens: 5,
      inputChars: 17,
      outputChars: 8,
    });
    recordLlmUsage({
      startedAt: "2026-06-08T01:00:00.000Z",
      durationMs: 100,
      provider: "DeepSeek-Flash",
      requestedProvider: "deepseek",
      model: "deepseek-chat",
      purpose: "chat",
      userId: 1,
      personaId: 7,
      route: "social.web.text_reply",
      success: true,
      inputTokens: 20,
      outputTokens: 10,
      inputChars: 34,
      outputChars: 17,
    });
    recordLlmUsage({
      startedAt: "2026-06-08T01:01:00.000Z",
      durationMs: 300,
      provider: "DeepSeek-Pro",
      requestedProvider: "deepseek",
      model: "deepseek-reasoner",
      purpose: "source_recall",
      userId: 1,
      personaId: 7,
      route: "social.web.source_grounding",
      success: false,
      inputTokens: 40,
      outputTokens: 0,
      inputChars: 68,
      outputChars: 0,
      error: "rate limit",
    });

    const snapshot = getLlmUsageSnapshot(new Date("2026-06-08T12:00:00.000Z"));

    expect(snapshot.today).toEqual({
      calls: 2,
      successfulCalls: 1,
      failedCalls: 1,
      inputTokens: 60,
      outputTokens: 10,
      totalTokens: 70,
      averageDurationMs: 200,
    });
    expect(snapshot.byProvider).toEqual([
      { provider: "DeepSeek-Pro", calls: 1, totalTokens: 40, averageDurationMs: 300 },
      { provider: "DeepSeek-Flash", calls: 1, totalTokens: 30, averageDurationMs: 100 },
    ]);
    expect(snapshot.byPurpose).toEqual([
      { purpose: "source_recall", calls: 1, totalTokens: 40, averageDurationMs: 300 },
      { purpose: "chat", calls: 1, totalTokens: 30, averageDurationMs: 100 },
    ]);
    expect(snapshot.byUser).toEqual([
      { userId: 1, calls: 2, totalTokens: 70, averageDurationMs: 200 },
    ]);
    expect(snapshot.byPersona).toEqual([
      { personaId: 7, calls: 2, totalTokens: 70, averageDurationMs: 200 },
    ]);
    expect(snapshot.byRoute).toEqual([
      { route: "social.web.source_grounding", calls: 1, totalTokens: 40, averageDurationMs: 300 },
      { route: "social.web.text_reply", calls: 1, totalTokens: 30, averageDurationMs: 100 },
    ]);
    expect(snapshot.recent.map(item => item.id)).toEqual([3, 2, 1]);
    expect(snapshot.recent[0]?.totalTokens).toBe(40);
    expect(snapshot.recent[0]?.error).toBe("rate limit");
  });

  it("emits complete records to the optional persistent recorder without blocking memory tracking", () => {
    const persisted: any[] = [];
    setLlmUsagePersistentRecorder(record => {
      persisted.push(record);
    });

    recordLlmUsage({
      startedAt: "2026-06-08T02:00:00.000Z",
      durationMs: 250,
      provider: "DeepSeek-Flash",
      requestedProvider: "deepseek",
      model: "deepseek-chat",
      purpose: "chat",
      userId: 2,
      personaId: 9,
      route: "social.qq.text_reply",
      success: true,
      inputTokens: 12,
      outputTokens: 8,
      inputChars: 20,
      outputChars: 14,
    });

    expect(persisted).toEqual([
      expect.objectContaining({
        id: 1,
        provider: "DeepSeek-Flash",
        userId: 2,
        personaId: 9,
        route: "social.qq.text_reply",
        totalTokens: 20,
        inputChars: 20,
        outputChars: 14,
      }),
    ]);
    expect(getLlmUsageSnapshot(new Date("2026-06-08T12:00:00.000Z")).today.totalTokens).toBe(20);
  });

  it("filters detailed records by attribution, route, provider, purpose, status, date and limit", () => {
    recordLlmUsage({
      startedAt: "2026-06-08T01:00:00.000Z",
      durationMs: 100,
      provider: "DeepSeek-Flash",
      requestedProvider: "deepseek",
      model: "deepseek-chat",
      purpose: "chat",
      userId: 1,
      personaId: 7,
      route: "social.web.text_reply",
      success: true,
      inputTokens: 20,
      outputTokens: 10,
      inputChars: 34,
      outputChars: 17,
    });
    recordLlmUsage({
      startedAt: "2026-06-08T01:05:00.000Z",
      durationMs: 200,
      provider: "DeepSeek-Pro",
      requestedProvider: "deepseek",
      model: "deepseek-reasoner",
      purpose: "source_recall",
      userId: 1,
      personaId: 7,
      route: "social.qq.source_grounding",
      success: false,
      inputTokens: 40,
      outputTokens: 0,
      inputChars: 68,
      outputChars: 0,
      error: "rate limit",
    });
    recordLlmUsage({
      startedAt: "2026-06-08T01:10:00.000Z",
      durationMs: 300,
      provider: "OpenAI",
      requestedProvider: "openai",
      model: "gpt-test",
      purpose: "chat",
      userId: 2,
      personaId: 9,
      route: "social.web.text_reply",
      success: true,
      inputTokens: 60,
      outputTokens: 20,
      inputChars: 102,
      outputChars: 34,
    });

    const details = getLlmUsageDetails({
      from: "2026-06-08T01:01:00.000Z",
      to: "2026-06-08T01:09:00.000Z",
      userId: 1,
      personaId: 7,
      route: "qq",
      provider: "pro",
      purpose: "source",
      success: false,
      limit: 500,
    });

    expect(details.source).toBe("in-memory-runtime");
    expect(details.filters.limit).toBe(200);
    expect(details.summary).toEqual({
      calls: 1,
      successfulCalls: 0,
      failedCalls: 1,
      inputTokens: 40,
      outputTokens: 0,
      totalTokens: 40,
      averageDurationMs: 200,
    });
    expect(details.records).toEqual([
      expect.objectContaining({
        id: 2,
        provider: "DeepSeek-Pro",
        userId: 1,
        personaId: 7,
        route: "social.qq.source_grounding",
        success: false,
        totalTokens: 40,
        error: "rate limit",
      }),
    ]);
  });

  it("can filter unassigned detailed records", () => {
    recordLlmUsage({
      startedAt: "2026-06-08T01:00:00.000Z",
      durationMs: 100,
      provider: "DeepSeek-Flash",
      requestedProvider: "deepseek",
      model: "deepseek-chat",
      purpose: "utility",
      success: true,
      inputTokens: 10,
      outputTokens: 5,
      inputChars: 17,
      outputChars: 8,
    });
    recordLlmUsage({
      startedAt: "2026-06-08T01:05:00.000Z",
      durationMs: 120,
      provider: "DeepSeek-Flash",
      requestedProvider: "deepseek",
      model: "deepseek-chat",
      purpose: "chat",
      userId: 1,
      personaId: 7,
      route: "social.web.text_reply",
      success: true,
      inputTokens: 20,
      outputTokens: 10,
      inputChars: 34,
      outputChars: 17,
    });

    const details = getLlmUsageDetails({ userId: null, personaId: null });

    expect(details.summary.calls).toBe(1);
    expect(details.records[0]).toEqual(expect.objectContaining({
      id: 1,
      purpose: "utility",
      totalTokens: 15,
    }));
    expect(details.records[0]).not.toHaveProperty("userId");
    expect(details.records[0]).not.toHaveProperty("personaId");
  });
});
