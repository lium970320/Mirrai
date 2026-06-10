import { afterEach, describe, expect, it } from "vitest";
import { clearOperationsEvents, recordOperationsEvent } from "../_core/operations-events";
import {
  getDatabaseRuntimeDiagnostics,
  getLlmBudgetDiagnostics,
  getOperationsDiagnostics,
  getOperationsTroubleshootingDiagnostics,
  getOutputStrategyDiagnostics,
} from "./output-diagnostics";

describe("output strategy diagnostics", () => {
  afterEach(() => {
    clearOperationsEvents();
  });

  it("summarizes voice, sticker and proactive output settings without exposing secrets", () => {
    const diagnostics = getOutputStrategyDiagnostics({
      proactiveMessages: {
        enabled: true,
        times: ["09:00", "21:30"],
        stylePrompt: "像真实私聊一样自然一点，避免精确打卡感。",
      },
    });

    expect(diagnostics.qq).toHaveProperty("accessTokenConfigured");
    expect(diagnostics.qq).toHaveProperty("webhookSecretConfigured");
    expect(diagnostics.qq).not.toHaveProperty("accessToken");
    expect(diagnostics.qq).not.toHaveProperty("webhookSecret");
    expect(diagnostics.voice.policy).toMatchObject({
      enabled: expect.any(Boolean),
      mode: expect.any(String),
      cooldownSeconds: expect.any(Number),
    });
    expect(diagnostics.stickers.enabled).toBeGreaterThan(0);
    expect(diagnostics.stickers.enabledByType.png).toBeGreaterThan(0);
    expect(diagnostics.proactiveMessages).toMatchObject({
      enabled: true,
      configuredSlotCount: 2,
      stylePromptConfigured: true,
    });
    expect(diagnostics.platformRuntime.qq).toMatchObject({
      text: true,
      voiceInput: true,
      voiceOutput: diagnostics.voice.policy.enabled,
      stickers: diagnostics.stickers.policy.enabled,
      proactiveMessages: true,
    });
  });

  it("classifies database runtime mode without returning credentials", () => {
    const neon = getDatabaseRuntimeDiagnostics("postgresql://user:secret@ep-orange-1.us-east-1.aws.neon.tech/mirrai?sslmode=require");
    expect(neon).toMatchObject({
      configured: true,
      mode: "neon",
      host: "ep-orange-1.us-east-1.aws.neon.tech",
      database: "mirrai",
      sslConfigured: true,
      recommendedDevCommand: "corepack pnpm run dev",
    });
    expect(JSON.stringify(neon)).not.toContain("secret");
    expect(JSON.stringify(neon)).not.toContain("user:");

    const local = getDatabaseRuntimeDiagnostics("postgresql://postgres:password@127.0.0.1:5434/mirrai");
    expect(local).toMatchObject({
      configured: true,
      mode: "local",
      host: "127.0.0.1",
      port: "5434",
      recommendedDevCommand: "corepack pnpm run dev:local",
    });
    expect(JSON.stringify(local)).not.toContain("password");
  });

  it("builds operations diagnostics for settings without exposing env secrets", () => {
    const diagnostics = getOperationsDiagnostics({
      databaseUrl: "postgresql://mirrai:top-secret@127.0.0.1:5434/mirrai",
      cwd: "F:/Code/Mirrai",
      now: new Date("2026-06-08T00:00:00.000Z"),
      personas: [
        {
          id: 1,
          name: "A",
          analysisStatus: "ready",
          llmProvider: "deepseek",
          personaData: {
            proactiveMessages: {
              enabled: true,
              times: ["09:00", "21:30"],
              stylePrompt: "自然一点",
            },
          },
        },
        {
          id: 2,
          name: "B",
          analysisStatus: "pending",
          personaData: {},
        },
      ],
    });

    expect(diagnostics.database).toMatchObject({
      mode: "local",
      recommendedDevCommand: "corepack pnpm run dev:local",
    });
    expect(diagnostics.proactiveMessages).toMatchObject({
      totalPersonas: 2,
      readyPersonas: 1,
      enabledPersonas: 1,
      configuredSlotCount: 2,
      stylePromptConfiguredPersonas: 1,
      llmProviderOverrides: { deepseek: 1 },
    });
    expect(diagnostics.llm).toMatchObject({
      defaultProvider: expect.any(String),
      providers: expect.any(Array),
      usage: {
        byUser: [],
        byPersona: [],
        byRoute: [],
      },
      economy: {
        limitsSummary: {
          context: {
            historyFetchLimit: expect.any(Number),
            llmHistoryLimit: expect.any(Number),
          },
          memoryRecall: {
            maxMemories: expect.any(Number),
            maxDescriptionChars: expect.any(Number),
          },
          sourceRecall: {
            maxChunks: expect.any(Number),
            maxExcerptChars: expect.any(Number),
            maxRewriteTokens: expect.any(Number),
          },
          safeguards: expect.any(Array),
        },
      },
    });
    expect(diagnostics.llm.economy.limitsSummary.context.description).toContain("进入 LLM 历史上下文");
    expect(diagnostics.llm.economy.limitsSummary.sourceRecall.description).toContain("证据改写");
    expect(diagnostics.llm.economy.limitsSummary.safeguards.join("\n")).toContain("不是质量目标");
    expect(diagnostics.platformRuntime.qq).toHaveProperty("voiceOutput");
    expect(diagnostics.persistence).toMatchObject({
      runtimeStorage: {
        personaRuntime: "persona_runtime_states",
        llmUsage: "llm_usage_records",
      },
    });
    expect(diagnostics.persistence.exportSections).toContain("personaRuntimeStates");
    expect(diagnostics.persistence.deleteSections).toContain("personaRuntimeStates");
    expect(diagnostics.persistence.requiredMigrations).toContain("0008_persona_runtime_states.sql");

    const serialized = JSON.stringify(diagnostics);
    expect(serialized).not.toContain("top-secret");
    expect(serialized).not.toMatch(/"(apiKey|accessToken|webhookSecret|password)"\s*:/i);
  });

  it("summarizes LLM soft budget state without enforcing runtime behavior", () => {
    expect(getLlmBudgetDiagnostics(undefined, {
      dailyLimit: 0,
      monthlyLimit: 0,
    })).toMatchObject({
      enabled: false,
      status: "disabled",
      daily: { limit: 0, remaining: null, status: "disabled" },
      monthly: { limit: 0, remaining: null, status: "disabled" },
    });

    expect(getLlmBudgetDiagnostics({
      today: { totalTokens: 85 },
      month: { totalTokens: 120 },
    }, {
      dailyLimit: 100,
      monthlyLimit: 1000,
      warningRatio: 0.8,
    })).toMatchObject({
      enabled: true,
      status: "warn",
      daily: { limit: 100, used: 85, remaining: 15, status: "warn" },
      monthly: { limit: 1000, used: 120, remaining: 880, status: "ok" },
    });

    expect(getLlmBudgetDiagnostics({
      today: { totalTokens: 100 },
      month: { totalTokens: 1200 },
    }, {
      dailyLimit: 100,
      monthlyLimit: 1000,
      warningRatio: 0.8,
    })).toMatchObject({
      status: "exceeded",
      daily: { status: "exceeded", remaining: 0 },
      monthly: { status: "exceeded", remaining: 0 },
    });
  });

  it("builds a sanitized raw-error troubleshooting checklist", () => {
    const diagnostics = getOperationsTroubleshootingDiagnostics({
      database: getDatabaseRuntimeDiagnostics("not a postgres url"),
      llmUsageReadError: "postgresql://mirrai:top-secret@127.0.0.1:5434/mirrai relation \"llm_usage_records\" does not exist",
      qq: {
        config: {
          enabled: true,
          onebotEndpoint: { origin: "http://127.0.0.1:3001" },
        },
        live: {
          enabled: true,
          status: "error",
          lastError: "fetch failed ECONNREFUSED 127.0.0.1:3001 token=secret-token",
        },
      },
      wechat: {
        config: {
          enabled: true,
        },
        live: {
          status: "error",
          syncCircuitBreakerTripped: true,
          lastError: {
            code: "WECHAT_SYNC_CIRCUIT_BREAKER",
            message: "HTTP 400 login failed",
            detail: "session password=secret",
          },
        },
      },
    });

    expect(diagnostics.summary).toMatchObject({
      total: 4,
      errors: 3,
      warnings: 1,
    });
    expect(diagnostics.items.map(item => item.id)).toEqual([
      "database.invalid_url",
      "llm.usage_database_read_failed",
      "qq.onebot_unreachable",
      "wechat.sync_circuit_breaker",
    ]);
    expect(diagnostics.items.find(item => item.id === "qq.onebot_unreachable")?.actions.length).toBeGreaterThan(0);
    expect(diagnostics.platforms.qq).toMatchObject({
      title: "NapCat / OneBot HTTP API 不可访问",
      tone: "error",
    });

    const serialized = JSON.stringify(diagnostics);
    expect(serialized).not.toContain("top-secret");
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("password=secret");
  });

  it("keeps healthy platform states out of the actionable checklist", () => {
    const diagnostics = getOperationsTroubleshootingDiagnostics({
      database: getDatabaseRuntimeDiagnostics("postgresql://mirrai:password@127.0.0.1:5434/mirrai"),
      qq: {
        config: { enabled: true },
        live: { enabled: true, status: "connected", loggedInUser: "Mirrai" },
      },
      wechat: {
        config: { enabled: true },
        live: { status: "logged_in", loggedInUser: "Mirrai" },
      },
    });

    expect(diagnostics.items).toEqual([]);
    expect(diagnostics.platforms.qq).toMatchObject({ tone: "ok" });
    expect(diagnostics.platforms.wechat).toMatchObject({ tone: "ok" });
  });

  it("turns recent voice and sticker runtime failures into sanitized troubleshooting items", () => {
    recordOperationsEvent({
      id: "voice.asr_request_failed",
      scope: "voice",
      title: "ASR 请求失败",
      detail: "智谱 ASR 接口返回错误，QQ 语音输入会降级到文字提示。",
      rawError: "HTTP 401 token=secret-asr-key",
      evidence: "provider=zhipu model=test-asr",
      at: "2026-06-08T00:00:00.000Z",
    });
    recordOperationsEvent({
      id: "stickers.onebot_send_failed",
      scope: "stickers",
      title: "OneBot 表情包发送失败",
      detail: "表情包文件有效，但 OneBot image 消息发送失败；主文字回复会保留。",
      rawError: "fetch failed access_token=secret-onebot-token",
      evidence: "contact=qq:private:1",
      at: "2026-06-08T00:00:01.000Z",
    });

    const diagnostics = getOperationsTroubleshootingDiagnostics({
      database: getDatabaseRuntimeDiagnostics("postgresql://mirrai:password@127.0.0.1:5434/mirrai"),
      qq: {
        config: { enabled: true },
        live: { enabled: true, status: "connected" },
      },
      wechat: {
        config: { enabled: true },
        live: { status: "logged_in" },
      },
    });

    expect(diagnostics.items.map(item => item.id)).toEqual(expect.arrayContaining([
      "voice.asr_request_failed",
      "stickers.onebot_send_failed",
    ]));
    expect(diagnostics.items.find(item => item.id === "voice.asr_request_failed")).toMatchObject({
      scope: "voice",
      tone: "error",
      evidence: "provider=zhipu model=test-asr",
    });
    expect(diagnostics.items.find(item => item.id === "stickers.onebot_send_failed")?.actions.join("\n"))
      .toContain("QQ_STICKER_BASE_DIR");

    const serialized = JSON.stringify(diagnostics);
    expect(serialized).not.toContain("secret-asr-key");
    expect(serialized).not.toContain("secret-onebot-token");
    expect(diagnostics.recentEvents).toHaveLength(2);
  });
});
