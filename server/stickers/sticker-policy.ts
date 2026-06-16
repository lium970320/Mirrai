import { ENV } from "../_core/env";
import type { StickerIntent } from "./sticker-intent";
import { looksSeriousOrTechnicalForSticker } from "./sticker-intent";

export type StickerReplyPolicyConfig = {
  enabled: boolean;
  probability: number;
  maxReplyLength: number;
  cooldownSeconds: number;
  allowInGroup: boolean;
  allowAfterUserSticker: boolean;
  allowAfterUserJoke: boolean;
  allowAfterUserTease: boolean;
};

export type StickerReplyPolicyInput = {
  contactId: string;
  contactKind: "private" | "group";
  inputText: string;
  replyText: string;
  userSentSticker?: boolean;
  stickerIntent?: StickerIntent;
  nowMs?: number;
  random?: () => number;
  config?: Partial<StickerReplyPolicyConfig>;
};

export type StickerReplyPolicyResult = {
  shouldSendSticker: boolean;
  reason: string;
  probabilityUsed?: number;
};

const lastStickerReplyAt = new Map<string, number>();

function currentConfig(overrides?: Partial<StickerReplyPolicyConfig>): StickerReplyPolicyConfig {
  return {
    enabled: ENV.qqStickerReplyEnabled,
    probability: Math.max(0, Math.min(1, ENV.qqStickerReplyProbability)),
    maxReplyLength: ENV.qqStickerReplyMaxReplyLength,
    cooldownSeconds: ENV.qqStickerReplyCooldownSeconds,
    allowInGroup: ENV.qqStickerReplyAllowGroups,
    allowAfterUserSticker: ENV.qqStickerReplyAllowAfterUserSticker,
    allowAfterUserJoke: ENV.qqStickerReplyAllowAfterUserJoke,
    allowAfterUserTease: ENV.qqStickerReplyAllowAfterUserTease,
    ...overrides,
  };
}

export function getStickerReplyPolicyConfig(overrides?: Partial<StickerReplyPolicyConfig>): StickerReplyPolicyConfig {
  return currentConfig(overrides);
}

function textLength(text: string): number {
  return Array.from(text.replace(/\s+/g, "")).length;
}

function isUserJokeOrTease(text: string): boolean {
  return /哈哈|笑死|开玩笑|逗你|逗我|调侃|坏|欠揍|哼|嘴硬|撒娇|夸你|夸我|抱抱|想你/.test(text);
}

function intentBoost(input: StickerReplyPolicyInput): number {
  const intent = input.stickerIntent;
  if (!intent?.shouldSend) return 0;
  if (input.userSentSticker) return 0.45;
  if (intent.tags?.some(tag => ["tease", "funny", "reaction", "close", "comfort"].includes(tag))) return 0.25;
  if ((intent.intensity ?? 0) >= 3) return 0.18;
  return 0.1;
}

export function checkStickerReplyPolicy(input: StickerReplyPolicyInput): StickerReplyPolicyResult {
  const config = currentConfig(input.config);
  const now = input.nowMs ?? Date.now();
  const random = input.random ?? Math.random;
  const intent = input.stickerIntent;
  console.info(`sticker_policy_checked contact=${input.contactId}`);

  if (!config.enabled) {
    return { shouldSendSticker: false, reason: "sticker_skipped_by_config" };
  }
  if (input.contactKind === "group" && !config.allowInGroup) {
    return { shouldSendSticker: false, reason: "sticker_skipped_by_group" };
  }
  if (textLength(input.replyText) > config.maxReplyLength) {
    return { shouldSendSticker: false, reason: "sticker_skipped_by_length" };
  }
  if (looksSeriousOrTechnicalForSticker(`${input.inputText}\n${input.replyText}`)) {
    return { shouldSendSticker: false, reason: "sticker_skipped_by_context" };
  }
  if (!intent?.shouldSend) {
    return { shouldSendSticker: false, reason: "sticker_skipped_by_intent" };
  }
  if (input.userSentSticker && !config.allowAfterUserSticker) {
    return { shouldSendSticker: false, reason: "sticker_skipped_by_config" };
  }
  const userJokeOrTease = isUserJokeOrTease(input.inputText);
  if (userJokeOrTease && !config.allowAfterUserJoke && !config.allowAfterUserTease) {
    return { shouldSendSticker: false, reason: "sticker_skipped_by_config" };
  }

  const lastAt = lastStickerReplyAt.get(input.contactId) ?? 0;
  if (config.cooldownSeconds > 0 && now - lastAt < config.cooldownSeconds * 1000) {
    return { shouldSendSticker: false, reason: "sticker_skipped_by_cooldown" };
  }

  const probabilityUsed = Math.max(0, Math.min(1, config.probability + intentBoost(input)));
  if (random() < probabilityUsed) {
    return { shouldSendSticker: true, reason: "sticker_selected_by_policy", probabilityUsed };
  }

  return { shouldSendSticker: false, reason: "sticker_skipped_by_probability", probabilityUsed };
}

export function markStickerReplySent(contactId: string, nowMs = Date.now()): void {
  lastStickerReplyAt.set(contactId, nowMs);
}
