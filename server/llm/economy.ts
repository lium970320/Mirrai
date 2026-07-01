import { ENV } from "../_core/env";

type LlmBudgetUsageLike = {
  today?: { totalTokens?: number | null } | null;
  month?: { totalTokens?: number | null } | null;
};

export type LlmBudgetStatus = "disabled" | "ok" | "warn" | "exceeded";
export type LlmEconomyLevel = "off" | "conservative" | "strict";
export type LlmRecallDegradationProfile =
  | "default"
  | "high_frequency_chat"
  | "relationship_focus"
  | "source_guarded"
  | "media_light"
  | "technical_light"
  | "proactive_minimal";

export type LlmBudgetDiagnostics = {
  enabled: boolean;
  status: LlmBudgetStatus;
  warningRatio: number;
  daily: {
    limit: number;
    used: number;
    remaining: number | null;
    status: LlmBudgetStatus;
  };
  monthly: {
    limit: number;
    used: number;
    remaining: number | null;
    status: LlmBudgetStatus;
  };
  recommendation: string;
};

export type LlmEconomyLimitsSummary = {
  mode: LlmEconomyLevel;
  context: {
    historyFetchLimit: number;
    llmHistoryLimit: number;
    continuityRecentLimit: number;
    continuityTimelineLimit: number;
    recallRecentLimit: number;
    description: string;
  };
  memoryRecall: {
    maxMemories: number;
    maxDescriptionChars: number;
    description: string;
  };
  sourceRecall: {
    maxChunks: number;
    maxExcerptChars: number;
    maxRewriteTokens: number;
    description: string;
  };
  routeSpecific: {
    active: boolean;
    profile: LlmRecallDegradationProfile;
    reasons: string[];
  };
  safeguards: string[];
  tuningAdvice: string;
};

export type LlmEconomyPolicy = {
  enabled: boolean;
  level: LlmEconomyLevel;
  budget: LlmBudgetDiagnostics;
  context: {
    historyFetchLimit: number;
    llmHistoryLimit: number;
    continuityRecentLimit: number;
    continuityTimelineLimit: number;
    reflectionRecentLimit: number;
    recallRecentLimit: number;
    consolidationRecentLimit: number;
  };
  voice: {
    allowSmartJudge: boolean;
    allowNonExplicitVoice: boolean;
  };
  tts: {
    allowLlmSpeechEnrichment: boolean;
  };
  proactive: {
    allowScheduled: boolean;
    allowAmbient: boolean;
  };
  memoryRecall: {
    maxMemories: number;
    maxDescriptionChars: number;
  };
  sourceRecall: {
    maxChunks: number;
    maxExcerptChars: number;
    maxRewriteTokens: number;
  };
  limitsSummary: LlmEconomyLimitsSummary;
  recommendation: string;
};

export type LlmRecallDegradationContext = {
  route?: string;
  platform?: string;
  intent?: string;
  sourceRecallActive?: boolean;
};

export type LlmTurnEconomyPolicy = LlmEconomyPolicy & {
  recallDegradation: {
    profile: LlmRecallDegradationProfile;
    route: string;
    platform: string;
    intent: string;
    sourceRecallActive: boolean;
    reasons: string[];
  };
};

let policyOverride: LlmEconomyPolicy | null = null;
let cachedRuntimePolicy: { expiresAt: number; policy: LlmEconomyPolicy } | null = null;
const RUNTIME_POLICY_CACHE_MS = 30_000;

function limitStatus(tokens: number, limit: number, warningRatio: number): LlmBudgetStatus {
  if (!limit || limit <= 0) return "disabled";
  if (tokens >= limit) return "exceeded";
  if (tokens >= Math.max(1, Math.round(limit * warningRatio))) return "warn";
  return "ok";
}

export function getLlmBudgetDiagnostics(
  usage: LlmBudgetUsageLike | undefined,
  options: {
    dailyLimit?: number;
    monthlyLimit?: number;
    warningRatio?: number;
  } = {},
): LlmBudgetDiagnostics {
  const dailyLimit = Math.max(0, options.dailyLimit ?? ENV.llmDailySoftTokenLimit);
  const monthlyLimit = Math.max(0, options.monthlyLimit ?? ENV.llmMonthlySoftTokenLimit);
  const warningRatioRaw = options.warningRatio ?? ENV.llmBudgetWarningRatio;
  const warningRatio = Number.isFinite(warningRatioRaw)
    ? Math.min(1, Math.max(0.1, warningRatioRaw))
    : 0.8;
  const todayTokens = Number(usage?.today?.totalTokens ?? 0);
  const monthTokens = Number(usage?.month?.totalTokens ?? 0);
  const todayStatus = limitStatus(todayTokens, dailyLimit, warningRatio);
  const monthStatus = limitStatus(monthTokens, monthlyLimit, warningRatio);
  const status = todayStatus === "exceeded" || monthStatus === "exceeded"
    ? "exceeded"
    : todayStatus === "warn" || monthStatus === "warn"
      ? "warn"
      : dailyLimit > 0 || monthlyLimit > 0
        ? "ok"
        : "disabled";

  return {
    enabled: dailyLimit > 0 || monthlyLimit > 0,
    status,
    warningRatio,
    daily: {
      limit: dailyLimit,
      used: todayTokens,
      remaining: dailyLimit > 0 ? Math.max(0, dailyLimit - todayTokens) : null,
      status: todayStatus,
    },
    monthly: {
      limit: monthlyLimit,
      used: monthTokens,
      remaining: monthlyLimit > 0 ? Math.max(0, monthlyLimit - monthTokens) : null,
      status: monthStatus,
    },
    recommendation: status === "exceeded"
      ? "已超过软额度，建议临时减少主动消息、语音智能判断和高成本原著召回。"
      : status === "warn"
        ? "接近软额度，建议观察高频入口并准备切换省额度策略。"
        : dailyLimit > 0 || monthlyLimit > 0
          ? "当前用量在软额度内。"
          : "未配置软额度；如需提醒，可设置 LLM_DAILY_SOFT_TOKEN_LIMIT 或 LLM_MONTHLY_SOFT_TOKEN_LIMIT。",
  };
}

export function buildLlmEconomyPolicy(
  usage: LlmBudgetUsageLike | undefined,
  options: {
    dailyLimit?: number;
    monthlyLimit?: number;
    warningRatio?: number;
  } = {},
): LlmEconomyPolicy {
  const budget = getLlmBudgetDiagnostics(usage, options);
  const level: LlmEconomyLevel = budget.status === "exceeded"
    ? "strict"
    : budget.status === "warn"
      ? "conservative"
      : "off";
  const strict = level === "strict";
  const conservative = level === "conservative";

  const context: LlmEconomyPolicy["context"] = {
    historyFetchLimit: strict ? 12 : conservative ? 16 : 20,
    llmHistoryLimit: strict ? 10 : conservative ? 14 : 19,
    continuityRecentLimit: strict ? 8 : conservative ? 10 : 12,
    continuityTimelineLimit: strict ? 6 : conservative ? 8 : 10,
    reflectionRecentLimit: strict ? 6 : conservative ? 8 : 12,
    recallRecentLimit: strict ? 4 : conservative ? 6 : 8,
    consolidationRecentLimit: strict ? 6 : conservative ? 8 : 12,
  };
  const memoryRecall: LlmEconomyPolicy["memoryRecall"] = {
    maxMemories: strict ? 2 : conservative ? 3 : 4,
    maxDescriptionChars: strict ? 140 : conservative ? 180 : 220,
  };
  const sourceRecall: LlmEconomyPolicy["sourceRecall"] = {
    maxChunks: strict ? 4 : conservative ? 6 : 9,
    maxExcerptChars: strict ? 480 : conservative ? 620 : 760,
    maxRewriteTokens: strict ? 320 : conservative ? 400 : 480,
  };

  return {
    enabled: level !== "off",
    level,
    budget,
    context,
    voice: {
      allowSmartJudge: !strict,
      allowNonExplicitVoice: !strict,
    },
    tts: {
      allowLlmSpeechEnrichment: !strict && !conservative,
    },
    proactive: {
      allowScheduled: !strict,
      allowAmbient: !strict && !conservative,
    },
    memoryRecall,
    sourceRecall,
    limitsSummary: buildLlmEconomyLimitsSummary({
      level,
      context,
      memoryRecall,
      sourceRecall,
    }),
    recommendation: strict
      ? "已进入严格省额度模式：暂停非强制主动消息、语音智能判断和 TTS LLM 润色，并缩短历史上下文与召回体量。"
      : conservative
        ? "已进入保守省额度模式：保留主动回复，暂停环境主动消息和 TTS LLM 润色，并适度缩短上下文与召回体量。"
      : "省额度模式未启用。",
  };
}

function cap(value: number, max: number): number {
  return Math.max(1, Math.min(value, max));
}

function capContext(
  context: LlmEconomyPolicy["context"],
  limits: Partial<LlmEconomyPolicy["context"]>,
): LlmEconomyPolicy["context"] {
  return {
    historyFetchLimit: limits.historyFetchLimit ? cap(context.historyFetchLimit, limits.historyFetchLimit) : context.historyFetchLimit,
    llmHistoryLimit: limits.llmHistoryLimit ? cap(context.llmHistoryLimit, limits.llmHistoryLimit) : context.llmHistoryLimit,
    continuityRecentLimit: limits.continuityRecentLimit ? cap(context.continuityRecentLimit, limits.continuityRecentLimit) : context.continuityRecentLimit,
    continuityTimelineLimit: limits.continuityTimelineLimit ? cap(context.continuityTimelineLimit, limits.continuityTimelineLimit) : context.continuityTimelineLimit,
    reflectionRecentLimit: limits.reflectionRecentLimit ? cap(context.reflectionRecentLimit, limits.reflectionRecentLimit) : context.reflectionRecentLimit,
    recallRecentLimit: limits.recallRecentLimit ? cap(context.recallRecentLimit, limits.recallRecentLimit) : context.recallRecentLimit,
    consolidationRecentLimit: limits.consolidationRecentLimit ? cap(context.consolidationRecentLimit, limits.consolidationRecentLimit) : context.consolidationRecentLimit,
  };
}

function capMemoryRecall(
  memoryRecall: LlmEconomyPolicy["memoryRecall"],
  limits: Partial<LlmEconomyPolicy["memoryRecall"]>,
): LlmEconomyPolicy["memoryRecall"] {
  return {
    maxMemories: limits.maxMemories ? cap(memoryRecall.maxMemories, limits.maxMemories) : memoryRecall.maxMemories,
    maxDescriptionChars: limits.maxDescriptionChars ? cap(memoryRecall.maxDescriptionChars, limits.maxDescriptionChars) : memoryRecall.maxDescriptionChars,
  };
}

function capSourceRecall(
  sourceRecall: LlmEconomyPolicy["sourceRecall"],
  limits: Partial<LlmEconomyPolicy["sourceRecall"]>,
): LlmEconomyPolicy["sourceRecall"] {
  return {
    maxChunks: limits.maxChunks ? cap(sourceRecall.maxChunks, limits.maxChunks) : sourceRecall.maxChunks,
    maxExcerptChars: limits.maxExcerptChars ? cap(sourceRecall.maxExcerptChars, limits.maxExcerptChars) : sourceRecall.maxExcerptChars,
    maxRewriteTokens: limits.maxRewriteTokens ? cap(sourceRecall.maxRewriteTokens, limits.maxRewriteTokens) : sourceRecall.maxRewriteTokens,
  };
}

export function buildLlmTurnEconomyPolicy(
  policy: LlmEconomyPolicy,
  context: LlmRecallDegradationContext = {},
): LlmTurnEconomyPolicy {
  const route = context.route?.trim() || "unknown";
  const platform = context.platform?.trim() || route.match(/^social\.([^.]+)\./)?.[1] || "unknown";
  const intent = context.intent?.trim() || "unknown";
  const sourceRecallActive = Boolean(context.sourceRecallActive)
    || intent === "source_recall"
    || intent === "correction"
    || route.includes("source_grounding");
  const highFrequencySocialRoute = /^social\.(qq|wechat)\./.test(route);
  const proactiveRoute = /(^|\.)(proactive|scheduled|ambient)(\.|$)/.test(route);
  const mediaRoute = intent === "media" || route.includes("media_reply");
  const technicalRoute = intent === "technical";
  const relationshipIntent = intent === "affection_expression" || intent === "emotional_support";
  const lowValueChatIntent = ["daily_chat", "teasing", "voice", "unknown"].includes(intent);
  let profile: LlmRecallDegradationProfile = "default";
  const reasons: string[] = [];
  let nextContext = { ...policy.context };
  let nextMemoryRecall = { ...policy.memoryRecall };
  let nextSourceRecall = { ...policy.sourceRecall };

  if (sourceRecallActive) {
    profile = "source_guarded";
    reasons.push("原著/纠错意图优先保留证据召回，同时压低长期关系记忆，避免记忆污染。");
    nextContext = capContext(nextContext, {
      llmHistoryLimit: 8,
      continuityRecentLimit: 6,
      continuityTimelineLimit: 4,
      reflectionRecentLimit: 5,
      recallRecentLimit: 4,
    });
    nextMemoryRecall = capMemoryRecall(nextMemoryRecall, {
      maxMemories: 1,
      maxDescriptionChars: 120,
    });
    nextSourceRecall = capSourceRecall(nextSourceRecall, highFrequencySocialRoute
      ? { maxChunks: 5, maxExcerptChars: 680 }
      : {});
  } else if (proactiveRoute) {
    profile = "proactive_minimal";
    reasons.push("主动消息入口应短、轻、少上下文，避免后台任务消耗过多召回额度。");
    nextContext = capContext(nextContext, {
      historyFetchLimit: 8,
      llmHistoryLimit: 6,
      continuityRecentLimit: 4,
      continuityTimelineLimit: 3,
      reflectionRecentLimit: 4,
      recallRecentLimit: 3,
      consolidationRecentLimit: 4,
    });
    nextMemoryRecall = capMemoryRecall(nextMemoryRecall, {
      maxMemories: 1,
      maxDescriptionChars: 100,
    });
    nextSourceRecall = capSourceRecall(nextSourceRecall, {
      maxChunks: 2,
      maxExcerptChars: 260,
      maxRewriteTokens: 220,
    });
  } else if (mediaRoute) {
    profile = "media_light";
    reasons.push("图片/表情包回复以当前媒体描述为主，只保留少量关系记忆和短上下文。");
    nextContext = capContext(nextContext, {
      historyFetchLimit: 10,
      llmHistoryLimit: 8,
      continuityRecentLimit: 6,
      continuityTimelineLimit: 4,
      recallRecentLimit: 4,
      consolidationRecentLimit: 6,
    });
    nextMemoryRecall = capMemoryRecall(nextMemoryRecall, {
      maxMemories: 2,
      maxDescriptionChars: 140,
    });
    nextSourceRecall = capSourceRecall(nextSourceRecall, {
      maxChunks: 2,
      maxExcerptChars: 300,
      maxRewriteTokens: 240,
    });
  } else if (technicalRoute) {
    profile = "technical_light";
    reasons.push("技术/正式问题减少人格记忆召回，优先让回复保持清楚直接。");
    nextContext = capContext(nextContext, {
      llmHistoryLimit: 8,
      continuityRecentLimit: 4,
      continuityTimelineLimit: 3,
      reflectionRecentLimit: 4,
      recallRecentLimit: 3,
      consolidationRecentLimit: 4,
    });
    nextMemoryRecall = capMemoryRecall(nextMemoryRecall, {
      maxMemories: 1,
      maxDescriptionChars: 100,
    });
    nextSourceRecall = capSourceRecall(nextSourceRecall, {
      maxChunks: 2,
      maxExcerptChars: 280,
      maxRewriteTokens: 220,
    });
  } else if (highFrequencySocialRoute && lowValueChatIntent) {
    profile = "high_frequency_chat";
    reasons.push("QQ / 微信日常短聊属于高频入口，压低长期记忆和原著召回体量；但保留足够的对话历史窗口，让人物能看见自己几轮前说过的话、避免复读。");
    nextContext = capContext(nextContext, {
      // 省的是“记忆/原著召回体量”，不是“对话历史”——历史砍太短模型看不见自己说过什么，必复读。
      historyFetchLimit: 20,
      llmHistoryLimit: 14,
      continuityRecentLimit: 10,
      continuityTimelineLimit: 8,
      reflectionRecentLimit: 5,
      recallRecentLimit: 4,
      consolidationRecentLimit: 6,
    });
    nextMemoryRecall = capMemoryRecall(nextMemoryRecall, {
      maxMemories: 2,
      maxDescriptionChars: 140,
    });
    nextSourceRecall = capSourceRecall(nextSourceRecall, {
      maxChunks: 2,
      maxExcerptChars: 360,
      maxRewriteTokens: 260,
    });
  } else if (relationshipIntent) {
    profile = "relationship_focus";
    reasons.push("情绪支持 / 深情表达保留关系记忆，但限制原著召回，避免把资料库事实混入亲密表达。");
    nextContext = capContext(nextContext, {
      llmHistoryLimit: 12,
      continuityRecentLimit: 8,
      continuityTimelineLimit: 6,
      recallRecentLimit: 6,
    });
    nextMemoryRecall = capMemoryRecall(nextMemoryRecall, {
      maxMemories: 4,
      maxDescriptionChars: 220,
    });
    nextSourceRecall = capSourceRecall(nextSourceRecall, {
      maxChunks: 3,
      maxExcerptChars: 360,
      maxRewriteTokens: 260,
    });
  } else {
    reasons.push("使用当前额度等级的默认召回上限。");
  }

  return {
    ...policy,
    context: nextContext,
    memoryRecall: nextMemoryRecall,
    sourceRecall: nextSourceRecall,
    limitsSummary: buildLlmEconomyLimitsSummary({
      level: policy.level,
      context: nextContext,
      memoryRecall: nextMemoryRecall,
      sourceRecall: nextSourceRecall,
      recallDegradation: {
        profile,
        reasons,
      },
    }),
    recallDegradation: {
      profile,
      route,
      platform,
      intent,
      sourceRecallActive,
      reasons,
    },
  };
}

export function setLlmEconomyPolicyOverrideForTests(policy: LlmEconomyPolicy | null) {
  policyOverride = policy;
  cachedRuntimePolicy = null;
}

function buildLlmEconomyLimitsSummary(options: {
  level: LlmEconomyLevel;
  context: LlmEconomyPolicy["context"];
  memoryRecall: LlmEconomyPolicy["memoryRecall"];
  sourceRecall: LlmEconomyPolicy["sourceRecall"];
  recallDegradation?: {
    profile: LlmRecallDegradationProfile;
    reasons: string[];
  };
}): LlmEconomyLimitsSummary {
  const routeSpecific = options.recallDegradation ?? {
    profile: "default" as const,
    reasons: [],
  };

  return {
    mode: options.level,
    context: {
      historyFetchLimit: options.context.historyFetchLimit,
      llmHistoryLimit: options.context.llmHistoryLimit,
      continuityRecentLimit: options.context.continuityRecentLimit,
      continuityTimelineLimit: options.context.continuityTimelineLimit,
      recallRecentLimit: options.context.recallRecentLimit,
      description: `每轮最多读取最近 ${options.context.historyFetchLimit} 条消息，其中最多 ${options.context.llmHistoryLimit} 条进入 LLM 历史上下文；连续性判断最多查看 ${options.context.continuityRecentLimit} 条近消息和 ${options.context.continuityTimelineLimit} 条时间线事件。`,
    },
    memoryRecall: {
      maxMemories: options.memoryRecall.maxMemories,
      maxDescriptionChars: options.memoryRecall.maxDescriptionChars,
      description: `长期记忆每轮最多召回 ${options.memoryRecall.maxMemories} 条，每条描述最多保留 ${options.memoryRecall.maxDescriptionChars} 字。`,
    },
    sourceRecall: {
      maxChunks: options.sourceRecall.maxChunks,
      maxExcerptChars: options.sourceRecall.maxExcerptChars,
      maxRewriteTokens: options.sourceRecall.maxRewriteTokens,
      description: `资料库每轮最多召回 ${options.sourceRecall.maxChunks} 个证据片段，每段摘录最多 ${options.sourceRecall.maxExcerptChars} 字；证据改写最多 ${options.sourceRecall.maxRewriteTokens} 输出 tokens。`,
    },
    routeSpecific: {
      active: routeSpecific.profile !== "default",
      profile: routeSpecific.profile,
      reasons: routeSpecific.reasons,
    },
    safeguards: [
      "这些数字是每轮保护上限，不是质量目标；调高会增加成本、延迟和上下文噪声。",
      "原著 / 资料库问题会保留证据召回，但压低关系记忆，避免把推测混进事实回答。",
      "主动消息、媒体回复和高频 QQ / 微信短聊会继续应用 route 级召回降级。",
    ],
    tuningAdvice: options.level === "strict"
      ? "严格模式下优先保留用户显式请求和证据核查，暂停或压缩后台与低价值链路。"
      : options.level === "conservative"
        ? "保守模式下先压缩召回体量和润色调用，普通聊天仍保持自然可用。"
        : "当前未触发省额度模式；如要控制成本，优先设置每日 / 月度软额度，而不是盲目调高上下文。",
  };
}

export async function getCurrentLlmEconomyPolicy(now = new Date()): Promise<LlmEconomyPolicy> {
  if (policyOverride) return policyOverride;
  const nowMs = now.getTime();
  if (cachedRuntimePolicy && cachedRuntimePolicy.expiresAt > nowMs) {
    return cachedRuntimePolicy.policy;
  }

  let usage: LlmBudgetUsageLike | undefined;
  try {
    const { getPersistentLlmUsageSnapshot } = await import("../db");
    usage = await getPersistentLlmUsageSnapshot(now) ?? undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[LLM economy] Failed to read persistent usage, fallback to memory:", message);
    const { getLlmUsageSnapshot } = await import("./usage");
    usage = getLlmUsageSnapshot(now);
  }

  const policy = buildLlmEconomyPolicy(usage);
  cachedRuntimePolicy = {
    expiresAt: nowMs + RUNTIME_POLICY_CACHE_MS,
    policy,
  };
  return policy;
}
