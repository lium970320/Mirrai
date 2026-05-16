import { ENV } from "../_core/env";

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

export type VoiceReplyPolicyInput = {
  contactId: string;
  contactKind: "private" | "group";
  inputText: string;
  replyText: string;
  replyChunks?: string[];
  source: VoiceReplySource;
  nowMs?: number;
  random?: () => number;
  config?: Partial<VoiceReplyPolicyConfig>;
  smartJudge?: VoiceReplySmartJudge;
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

const lastVoiceReplyAt = new Map<string, number>();
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

function textLength(text: string): number {
  return Array.from(text.replace(/\s+/g, "")).length;
}

function replyChunksForPolicy(input: VoiceReplyPolicyInput): string[] {
  const chunks = input.replyChunks?.map(chunk => chunk.trim()).filter(Boolean);
  return chunks?.length ? chunks : [input.replyText];
}

function explicitVoiceRequest(text: string): boolean {
  return /语音回|发语音|用语音|说出来|念出来|读出来|用声音/.test(text);
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
  const explicit = explicitVoiceRequest(input.inputText);
  console.info(`voice_reply_policy_checked contact=${input.contactId} source=${input.source}`);

  if (!config.enabled || config.mode === "never") {
    return { shouldSendVoice: false, reason: "voice_reply_skipped_by_config", fallbackToText: true };
  }
  if (explicit) {
    return { shouldSendVoice: true, reason: "voice_reply_selected_by_request", fallbackToText: true };
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
  lastVoiceReplyAt.set(contactId, nowMs);
}
