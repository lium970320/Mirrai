import { ENV } from "../_core/env";

export type VoiceReplyMode = "never" | "sometimes" | "always";
export type VoiceReplySource = "text" | "voice";

export type VoiceReplyPolicyConfig = {
  enabled: boolean;
  mode: VoiceReplyMode;
  probability: number;
  onlyWhenUserSentVoice: boolean;
  maxTextLength: number;
  cooldownSeconds: number;
  allowInGroup: boolean;
};

export type VoiceReplyPolicyInput = {
  contactId: string;
  contactKind: "private" | "group";
  inputText: string;
  replyText: string;
  source: VoiceReplySource;
  nowMs?: number;
  random?: () => number;
  config?: Partial<VoiceReplyPolicyConfig>;
};

export type VoiceReplyPolicyResult = {
  shouldSendVoice: boolean;
  reason: string;
  fallbackToText: boolean;
  probabilityUsed?: number;
};

const lastVoiceReplyAt = new Map<string, number>();

function normalizeMode(mode: string): VoiceReplyMode {
  if (mode === "never" || mode === "always" || mode === "sometimes") return mode;
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
    ...overrides,
  };
}

function textLength(text: string): number {
  return Array.from(text.replace(/\s+/g, "")).length;
}

function explicitVoiceRequest(text: string): boolean {
  return /语音回|发语音|用语音|说出来|念出来|读出来|用声音/.test(text);
}

function looksSeriousOrTechnical(text: string): boolean {
  return /代码|bug|报错|数据库|接口|部署|配置|论文|作业|分析|解释|为什么|怎么实现|技术|公式/.test(text);
}

export function checkVoiceReplyPolicy(input: VoiceReplyPolicyInput): VoiceReplyPolicyResult {
  const config = currentConfig(input.config);
  const now = input.nowMs ?? Date.now();
  const random = input.random ?? Math.random;
  const explicit = explicitVoiceRequest(input.inputText);
  console.info(`voice_reply_policy_checked contact=${input.contactId} source=${input.source}`);

  if (!config.enabled || config.mode === "never") {
    return { shouldSendVoice: false, reason: "voice_reply_skipped_by_config", fallbackToText: true };
  }
  if (input.contactKind === "group" && !config.allowInGroup) {
    return { shouldSendVoice: false, reason: "voice_reply_skipped_by_group", fallbackToText: true };
  }
  if (textLength(input.replyText) > config.maxTextLength) {
    return { shouldSendVoice: false, reason: "voice_reply_skipped_by_length", fallbackToText: true };
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

  if (explicit || config.mode === "always") {
    return { shouldSendVoice: true, reason: explicit ? "voice_reply_selected_by_request" : "voice_reply_selected_by_mode", fallbackToText: true };
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

