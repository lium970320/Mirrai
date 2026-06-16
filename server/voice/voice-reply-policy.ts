import { ENV } from "../_core/env";
import { getCurrentLlmEconomyPolicy, type LlmEconomyPolicy } from "../llm/economy";

export type VoiceReplyMode = "never" | "requested" | "smart" | "sometimes" | "always";
export type VoiceReplySource = "text" | "voice";

export type VoiceReplyPolicyConfig = {
  enabled: boolean;
  mode: VoiceReplyMode;
  probability: number;
  onlyWhenUserSentVoice: boolean;
  maxTextLength: number;
  cooldownSeconds: number;
  allowInGroup: boolean;
  smartProvider: string;
  smartMinConfidence: number;
};

export type VoiceRequestDecision = {
  explicitVoiceRequest: boolean;
  confidence?: number;
  reason?: string;
};

export type VoiceReplyPolicyInput = {
  contactId: string;
  contactKind: "private" | "group";
  inputText: string;
  conversationContext?: string;
  replyText: string;
  replyChunks?: string[];
  source: VoiceReplySource;
  nowMs?: number;
  random?: () => number;
  config?: Partial<VoiceReplyPolicyConfig>;
  voiceRequestDecision?: VoiceRequestDecision | null;
  smartJudge?: VoiceReplySmartJudge;
  voiceRequestJudge?: VoiceRequestJudge;
  economyPolicy?: LlmEconomyPolicy;
};

export type VoiceReplyPolicyResult = {
  shouldSendVoice: boolean;
  reason: string;
  fallbackToText: boolean;
  probabilityUsed?: number;
};

export type VoiceReplySmartJudgeResult = {
  shouldSendVoice: boolean;
  confidence?: number;
  reason?: string;
};

export type VoiceReplySmartJudge = (input: VoiceReplyPolicyInput) => Promise<VoiceReplySmartJudgeResult>;
export type VoiceRequestJudge = (input: VoiceReplyPolicyInput) => Promise<VoiceRequestDecision>;

const lastVoiceReplyAt = new Map<string, number>();
const VOICE_COOLDOWN_MAX_ENTRIES = 2000;
const VOICE_COOLDOWN_ENTRY_TTL_MS = 60 * 60 * 1000;
const MAX_NON_EXPLICIT_VOICE_CHUNKS = 3;

function normalizeMode(mode: string): VoiceReplyMode {
  if (mode === "never" || mode === "requested" || mode === "smart" || mode === "always" || mode === "sometimes") return mode;
  if (mode === "explicit" || mode === "on-request" || mode === "on_request") return "requested";
  if (mode === "auto" || mode === "natural" || mode === "daily") return "smart";
  return "sometimes";
}

function currentConfig(overrides?: Partial<VoiceReplyPolicyConfig>): VoiceReplyPolicyConfig {
  return {
    enabled: ENV.qqVoiceReplyEnabled,
    mode: normalizeMode(ENV.qqVoiceReplyMode),
    probability: Math.max(0, Math.min(1, ENV.qqVoiceReplyProbability)),
    onlyWhenUserSentVoice: ENV.qqVoiceReplyOnlyWhenUserSentVoice,
    maxTextLength: ENV.qqVoiceReplyMaxTextLength,
    cooldownSeconds: ENV.qqVoiceReplyCooldownSeconds,
    allowInGroup: ENV.qqVoiceReplyAllowGroups,
    smartProvider: ENV.qqVoiceReplySmartProvider,
    smartMinConfidence: Math.max(0, Math.min(1, ENV.qqVoiceReplySmartMinConfidence)),
    ...overrides,
  };
}

export function getVoiceReplyPolicyConfig(overrides?: Partial<VoiceReplyPolicyConfig>): VoiceReplyPolicyConfig {
  return currentConfig(overrides);
}

function textLength(text: string): number {
  return Array.from(text.replace(/\s+/g, "")).length;
}

function replyChunksForPolicy(input: VoiceReplyPolicyInput): string[] {
  const chunks = input.replyChunks?.map(chunk => chunk.trim()).filter(Boolean);
  return chunks?.length ? chunks : [input.replyText];
}

const EXPLICIT_VOICE_REQUEST_PATTERNS = [
  /用语音/,
  /语音(?:回|回复|说|发|来|给我|一下|一段|一条)/,
  /发(?:一段|一条|个|个儿|长(?:一点)?的?|久(?:一点)?的?)?语音/,
  /听.{0,8}发.{0,8}语音/,
  /语音(?:长|久)(?:一点)?/,
  /(?:说|念|读)(?:出来|给我听|给我|一下|一遍|两遍|三遍|几遍)/,
  /(?:给我|跟我|对我)说(?:话|句话|一声)/,
  /说话给我听/,
  /(?:我要|我想|想要|要|想|让我|给我).{0,8}(?:听|听听).{0,6}(?:你的?)?声音/,
  /听(?:听)?(?:你的?)?声音/,
  /用声音/,
  /开口(?:说|回)/,
];

export function isExplicitVoiceRequest(text: string): boolean {
  const compact = text
    .replace(/\s+/g, "")
    .replace(/[，,。.!！?？、；;：:\-—_“”"'‘’「」『』（）()[\]{}]/g, "");
  return EXPLICIT_VOICE_REQUEST_PATTERNS.some(pattern => pattern.test(compact));
}

function isNegatedVoiceRequest(text: string): boolean {
  const compact = text
    .replace(/\s+/g, "")
    .replace(/[，,。.!！?？、；;：:\-—_“”"'‘’「」『』（）()[\]{}]/g, "");
  return /不是(?:让|叫|要|想要)?你?发语音|不是(?:让|叫|要|想要)?你?用语音|不用语音|不要语音|别发语音/.test(compact);
}

function looksLikeVoiceContinuation(text: string): boolean {
  const compact = text
    .replace(/\s+/g, "")
    .replace(/[，,。.!！?？、；;：:\-—_“”"'‘’「」『』（）()[\]{}]/g, "");
  return /^(再来|继续|接着|多说|多讲|再说|长一点|长点|久一点|说久一点|说长一点|多一点|别这么短|太短|不够|换个说法|一长段)/.test(compact)
    || /(?:再|继续).{0,6}(?:说|讲|语音|声音)/.test(compact)
    || /(?:长一点|长点|久一点|多一点|一长段).{0,6}(?:语音|声音|说|讲)/.test(compact);
}

function contextHasRecentVoiceRequest(context: string | undefined): boolean {
  if (!context) return false;
  return isExplicitVoiceRequest(context) || /听.{0,12}(?:你的?)?声音|发.{0,12}语音|用语音|一条语音|一段语音/.test(context);
}

function buildVoiceRequestJudgeFallback(input: VoiceReplyPolicyInput): VoiceRequestDecision {
  if (isNegatedVoiceRequest(input.inputText)) {
    return {
      explicitVoiceRequest: false,
      confidence: 0.55,
      reason: "fallback_negated_voice_request",
    };
  }
  if (isExplicitVoiceRequest(input.inputText)) {
    return {
      explicitVoiceRequest: true,
      confidence: 0.35,
      reason: "fallback_regex",
    };
  }
  if (looksLikeVoiceContinuation(input.inputText) && contextHasRecentVoiceRequest(input.conversationContext)) {
    return {
      explicitVoiceRequest: true,
      confidence: 0.5,
      reason: "fallback_context_voice_continuation",
    };
  }
  return {
    explicitVoiceRequest: false,
    confidence: 0.35,
    reason: "fallback_regex",
  };
}

async function judgeVoiceRequestWithLlm(
  input: VoiceReplyPolicyInput,
  config: VoiceReplyPolicyConfig,
): Promise<VoiceRequestDecision> {
  const { llmService } = await import("../llm");
  console.info(`voice_reply_request_judge_start contact=${input.contactId}`);
  const response = await llmService.invoke({
    messages: [
      {
        role: "system",
        content: [
          "你是中文聊天中的语音意图分类器。",
          "只判断用户这一轮是否明确要求机器人用语音回复、开口说话、发语音、念出来或读出来。",
          "要结合上下文和语气，不要只看表面关键词。",
          "如果只是提到语音功能、讨论语音本身、引用语音、或者没有要求对方用语音回答，就判 false。",
          "如果上一轮语境里已经在要求语音，这一轮像“再来一段”“继续”“长一点”也算 true。",
          "只返回 JSON：{\"explicitVoiceRequest\":true,\"confidence\":0.82,\"reason\":\"...\"}",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `用户输入：${input.inputText}`,
          input.conversationContext ? `上下文：${input.conversationContext}` : "",
          `聊天类型：${input.contactKind}`,
          `输入来源：${input.source}`,
        ].filter(Boolean).join("\n"),
      },
    ],
    options: {
      provider: config.smartProvider || undefined,
      maxTokens: 120,
      temperature: 0,
      purpose: "voice_policy",
      route: "voice.request_judge",
    },
  });
  const parsed = extractJsonObject(response);
  if (!parsed) {
    throw new Error("voice request judge returned non-JSON output");
  }
  const explicitVoiceRequest = parsed.explicitVoiceRequest === true;
  const confidenceValue = typeof parsed.confidence === "number" ? parsed.confidence : Number(parsed.confidence);
  const confidence = Number.isFinite(confidenceValue) ? Math.max(0, Math.min(1, confidenceValue)) : undefined;
  const reason = typeof parsed.reason === "string" ? parsed.reason.slice(0, 120) : undefined;
  console.info(`voice_reply_request_judge_result contact=${input.contactId} explicit=${explicitVoiceRequest} confidence=${confidence ?? "unknown"} reason=${reason ?? ""}`);
  return { explicitVoiceRequest, confidence, reason };
}

export async function detectVoiceRequestDecision(
  input: VoiceReplyPolicyInput,
  overrides?: Partial<VoiceReplyPolicyConfig>,
): Promise<VoiceRequestDecision> {
  const config = currentConfig(overrides ?? input.config);
  if (!config.smartProvider) {
    return buildVoiceRequestJudgeFallback(input);
  }

  try {
    const judge = input.voiceRequestJudge ?? ((judgeInput: VoiceReplyPolicyInput) => judgeVoiceRequestWithLlm(judgeInput, config));
    return await judge(input);
  } catch (err) {
    console.warn(`voice_reply_request_judge_failed contact=${input.contactId}`, err);
    return buildVoiceRequestJudgeFallback(input);
  }
}

function looksSeriousOrTechnical(text: string): boolean {
  return /代码|bug|报错|数据库|接口|部署|配置|论文|作业|分析|解释一下|怎么实现|技术|公式|日志|模型参数/.test(text);
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || text.match(/\{[\s\S]*\}/)?.[0] || "";
  if (!candidate.trim()) return null;
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

async function judgeVoiceSuitabilityWithLlm(
  input: VoiceReplyPolicyInput,
  config: VoiceReplyPolicyConfig,
): Promise<VoiceReplySmartJudgeResult> {
  const { llmService } = await import("../llm");
  console.info(`voice_reply_smart_judge_start contact=${input.contactId}`);
  const response = await llmService.invoke({
    messages: [
      {
        role: "system",
        content: [
          "你是中文 QQ/微信聊天的语音回复策略判断器。",
          "只判断机器人这次回复是否适合用一条短语音发出，不改写内容。",
          "适合语音：短、口语、日常、亲近、安慰、轻声叮嘱、撒娇/害羞/想念等像真人会说出口的话。",
          "不适合语音：正式、技术、解释、查询、长答案、复杂信息、需要回看、代码/列表/链接/数字较多、严肃问题。",
          "保守判断，宁可少发语音，不要频繁打扰。",
          "只返回 JSON：{\"shouldSendVoice\":true,\"confidence\":0.82,\"reason\":\"...\"}",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `用户输入：${input.inputText}`,
          `机器人回复：${input.replyText}`,
          `输入来源：${input.source}`,
          `聊天类型：${input.contactKind}`,
          `回复长度：${textLength(input.replyText)}`,
        ].join("\n"),
      },
    ],
    options: {
      provider: config.smartProvider || undefined,
      maxTokens: 180,
      temperature: 0.1,
      purpose: "voice_policy",
      route: "voice.smart_judge",
    },
  });
  const parsed = extractJsonObject(response);
  if (!parsed) {
    throw new Error("smart voice judge returned non-JSON output");
  }
  const shouldSendVoice = parsed.shouldSendVoice === true;
  const confidenceValue = typeof parsed.confidence === "number" ? parsed.confidence : Number(parsed.confidence);
  const confidence = Number.isFinite(confidenceValue) ? Math.max(0, Math.min(1, confidenceValue)) : undefined;
  const reason = typeof parsed.reason === "string" ? parsed.reason.slice(0, 120) : undefined;
  console.info(`voice_reply_smart_judge_result contact=${input.contactId} should=${shouldSendVoice} confidence=${confidence ?? "unknown"} reason=${reason ?? ""}`);
  return { shouldSendVoice, confidence, reason };
}

export async function checkVoiceReplyPolicy(input: VoiceReplyPolicyInput): Promise<VoiceReplyPolicyResult> {
  const config = currentConfig(input.config);
  const now = input.nowMs ?? Date.now();
  const random = input.random ?? Math.random;
  const voiceRequestDecision = input.voiceRequestDecision ?? await detectVoiceRequestDecision(input, config);
  const explicit = voiceRequestDecision.explicitVoiceRequest;
  const economy = input.economyPolicy ?? await getCurrentLlmEconomyPolicy(new Date(now));
  console.info(`voice_reply_policy_checked contact=${input.contactId} source=${input.source}`);

  if (!config.enabled || config.mode === "never") {
    return { shouldSendVoice: false, reason: "voice_reply_skipped_by_config", fallbackToText: true };
  }
  if (explicit) {
    return { shouldSendVoice: true, reason: "voice_reply_selected_by_request", fallbackToText: true };
  }
  if (!economy.voice.allowNonExplicitVoice) {
    return { shouldSendVoice: false, reason: "voice_reply_skipped_by_llm_budget", fallbackToText: true };
  }
  if (input.contactKind === "group" && !config.allowInGroup) {
    return { shouldSendVoice: false, reason: "voice_reply_skipped_by_group", fallbackToText: true };
  }
  if (replyChunksForPolicy(input).some(chunk => textLength(chunk) > config.maxTextLength)) {
    return { shouldSendVoice: false, reason: "voice_reply_skipped_by_length", fallbackToText: true };
  }
  const replyChunks = replyChunksForPolicy(input);
  if (!explicit && replyChunks.length > MAX_NON_EXPLICIT_VOICE_CHUNKS) {
    return { shouldSendVoice: false, reason: "voice_reply_skipped_by_length", fallbackToText: true };
  }
  if (!explicit && textLength(input.replyText) > config.maxTextLength) {
    return { shouldSendVoice: false, reason: "voice_reply_skipped_by_length", fallbackToText: true };
  }
  if (config.mode === "requested") {
    return { shouldSendVoice: false, reason: "voice_reply_skipped_by_request_only", fallbackToText: true };
  }
  if (!explicit && config.onlyWhenUserSentVoice && input.source !== "voice") {
    return { shouldSendVoice: false, reason: "voice_reply_skipped_by_source", fallbackToText: true };
  }
  if (!explicit && looksSeriousOrTechnical(input.inputText + "\n" + input.replyText)) {
    return { shouldSendVoice: false, reason: "voice_reply_skipped_by_context", fallbackToText: true };
  }

  const lastAt = lastVoiceReplyAt.get(input.contactId) ?? 0;
  if (!explicit && config.cooldownSeconds > 0 && now - lastAt < config.cooldownSeconds * 1000) {
    return { shouldSendVoice: false, reason: "voice_reply_skipped_by_cooldown", fallbackToText: true };
  }

  if (config.mode === "smart") {
    if (!economy.voice.allowSmartJudge) {
      return { shouldSendVoice: false, reason: "voice_reply_skipped_by_llm_budget", fallbackToText: true };
    }
    try {
      const judge = input.smartJudge ?? ((judgeInput: VoiceReplyPolicyInput) => judgeVoiceSuitabilityWithLlm(judgeInput, config));
      const decision = await judge(input);
      if (!decision.shouldSendVoice) {
        return { shouldSendVoice: false, reason: "voice_reply_skipped_by_smart_judge", fallbackToText: true };
      }
      if ((decision.confidence ?? 1) < config.smartMinConfidence) {
        return { shouldSendVoice: false, reason: "voice_reply_skipped_by_smart_confidence", fallbackToText: true };
      }
      return { shouldSendVoice: true, reason: "voice_reply_selected_by_smart", fallbackToText: true };
    } catch (err) {
      console.warn(`voice_reply_smart_judge_failed contact=${input.contactId}`, err);
      return { shouldSendVoice: false, reason: "voice_reply_skipped_by_smart_error", fallbackToText: true };
    }
  }

  if (config.mode === "always") {
    return { shouldSendVoice: true, reason: "voice_reply_selected_by_mode", fallbackToText: true };
  }

  const probabilityUsed = config.probability;
  if (random() < probabilityUsed) {
    return { shouldSendVoice: true, reason: "voice_reply_selected", fallbackToText: true, probabilityUsed };
  }

  return { shouldSendVoice: false, reason: "voice_reply_skipped_by_probability", fallbackToText: true, probabilityUsed };
}

export function markVoiceReplySent(contactId: string, nowMs = Date.now()): void {
  // 防止冷却 Map 无界增长：长期运行 / 联系人增多时，顺手清掉早已超出冷却窗口的旧条目。
  if (lastVoiceReplyAt.size > VOICE_COOLDOWN_MAX_ENTRIES) {
    for (const [key, at] of lastVoiceReplyAt) {
      if (nowMs - at > VOICE_COOLDOWN_ENTRY_TTL_MS) lastVoiceReplyAt.delete(key);
    }
  }
  lastVoiceReplyAt.set(contactId, nowMs);
}
