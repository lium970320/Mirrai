import { nanoid } from "nanoid";
import { buildCurrentUserIdentityOverride } from "../_core/current-user-identity";
import { applyIncomingLifeState } from "../_core/life-schedule";
import { withPersonaRuntimeDiagnostics, withPersonaRuntimeInnerState } from "../_core/persona-runtime";
import { buildSystemPrompt } from "../_core/persona-utils";
import { deriveEmotionalLabel, evolveInnerState, getEffectiveInnerState } from "../_core/persona-inner-state";
import { getPersonaLifeConfig } from "../_core/persona-life-config";
import { cleanAssistantReply } from "../_core/reply-utils";
import * as db from "../db";
import { llmService } from "../llm";
import { buildLlmTurnEconomyPolicy, getCurrentLlmEconomyPolicy } from "../llm/economy";
import { storagePut } from "../storage";
import { describeImage, type VisionImageInput } from "../vision";
import { buildConversationContinuityInstruction } from "./conversation-continuity";
import { buildPersonaMemoryRecallContext } from "./memory-recall";
import { buildTurnPlanInstruction, planPersonaTurn } from "./persona-turn-planner";
import {
  resolveRuntimeChannel,
  resolveRuntimeOutputPreference,
  type SocialRuntimeBinding,
  type SocialRuntimeChannel,
  type SocialRuntimeOutputPreference,
  type SocialRuntimePlatform,
} from "./runtime-request";

export type SocialMediaInput = VisionImageInput & {
  kind: "image" | "emoticon";
  caption?: string;
};

export type SocialPersonaMediaChatOptions = {
  platform: SocialRuntimePlatform;
  binding: SocialRuntimeBinding;
  contactName: string;
  media: SocialMediaInput;
  channel?: SocialRuntimeChannel;
  storagePrefix: string;
  sceneOverlay?: string | null;
  outputPreference?: SocialRuntimeOutputPreference;
};

export type SocialPersonaMediaChatResult = {
  replyText: string;
  emotionalState: string;
  userMessageId: number;
  assistantMessageId: number;
  mediaUrl?: string;
};

function platformLabel(platform: SocialRuntimePlatform): string {
  if (platform === "web") return "网页";
  return platform === "qq" ? "QQ" : "微信";
}

function sanitizeStorageName(fileName: string): string {
  return fileName.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim() || "social-image.jpg";
}

function mediaLabel(media: SocialMediaInput): string {
  if (media.kind === "emoticon") return "[表情包]";
  return "[图片]";
}

function mediaKindLabel(platform: SocialRuntimePlatform, media: SocialMediaInput): string {
  const platformName = platformLabel(platform);
  if (media.kind === "emoticon") return `${platformName}表情包`;
  return `${platformName}图片`;
}

function socialSystemPromptOverlay(platform: SocialRuntimePlatform): string {
  const label = platformLabel(platform);
  return [
    `【${label} 接入规则】${label} 只是同一个人物的另一个聊天入口，不是新身份、新关系或新时间线。`,
    "你必须沿用网页、微信和其他入口里的同一套人物设定、共同经历、称呼习惯、异地背景和情感进展。",
    buildCurrentUserIdentityOverride("平台用户身份覆盖"),
    "如果用户发来图片或表情包，只把它当作当前聊天中的自然内容来回应，不要提视觉模型、识别结果、接口或平台差异。",
    "回复节奏保持自然私聊感：能一句说清就一句，不要每次都关心、说教、催睡或总结；只有对方明显需要安慰、解释或认真讨论时才展开。",
  ].join("\n");
}

function mediaInstruction(
  platform: SocialRuntimePlatform,
  contactName: string,
  media: SocialMediaInput,
  description: string,
): string {
  const sender = contactName || "对方";
  const caption = media.caption?.trim();
  return [
    `${sender}发来了一张${mediaKindLabel(platform, media)}。视觉模型识别结果如下：`,
    description,
    caption ? `\n对方随图附带文字：${caption}` : "",
    "\n请只根据这段识别结果、随图文字和上下文，用你的人格口吻自然回应。不要写成图片说明，也不要说自己是AI。",
  ].filter(Boolean).join("\n");
}

function noVisionInstruction(platform: SocialRuntimePlatform, contactName: string, media: SocialMediaInput): string {
  const sender = contactName || "对方";
  const caption = media.caption?.trim();
  const base = media.kind === "emoticon"
    ? `${sender}发来了一张${mediaKindLabel(platform, media)}，但这次没有识别到具体画面。`
    : `${sender}发来了一张${mediaKindLabel(platform, media)}，但这次没有识别到具体画面。`;
  return [
    base,
    caption ? `对方随图附带文字：${caption}` : "",
    "请不要编造画面细节，不要说自己看不见，也不要提AI、视觉模型或技术问题；只把它当作对方用图片或表情包接话，用你的人格口吻自然回应，可以温柔地接住、轻轻调侃，或顺势问一句。",
  ].filter(Boolean).join("\n");
}

function mediaReplyLoopGuard(history: Array<{ role: string; content: string }>): string {
  const previousAssistant = [...history].reverse().find(message => message.role === "assistant")?.content ?? "";
  if (!/睡|休息|熬夜|明天|上课|躺|困/.test(previousAssistant)) return "";
  return "【话题防循环】上一轮已经把话题收束到睡觉、休息或明天安排。用户这次发图片/表情包，多半是在继续互动或表达情绪；不要再催睡或关闭话题，先回应图片/表情包带来的情绪。";
}

export async function handleSocialPersonaMediaChatDetailed(
  options: SocialPersonaMediaChatOptions,
): Promise<SocialPersonaMediaChatResult | null> {
  const persona = await db.getPersonaById(options.binding.personaId, options.binding.userId);
  if (!persona || persona.analysisStatus !== "ready") return null;
  const now = new Date();

  let url: string | undefined;
  if (options.media.buffer.byteLength > 0) {
    const safeFileName = sanitizeStorageName(options.media.fileName);
    const fileKey = `${options.storagePrefix}/${options.binding.userId}/${options.binding.personaId}/${nanoid()}-${safeFileName}`;
    ({ url } = await storagePut(fileKey, options.media.buffer, options.media.mimeType));
  }

  let visionDescription: string | null = null;
  try {
    visionDescription = await describeImage(options.media);
  } catch (err) {
    console.warn(`[${platformLabel(options.platform)}] Vision description failed:`, err);
  }

  const label = mediaLabel(options.media);
  const caption = options.media.caption?.trim();
  const userContent = [
    label,
    visionDescription,
    caption ? `附带文字：${caption}` : "",
  ].filter(Boolean).join("\n");

  const userMessageId = await db.createMessage({
    personaId: options.binding.personaId,
    userId: options.binding.userId,
    role: "user",
    content: userContent,
    messageType: "image",
    mediaUrl: url,
    emotionalState: persona.emotionalState,
    channel: resolveRuntimeChannel(options),
  });

  const baseEconomy = await getCurrentLlmEconomyPolicy();
  const economy = buildLlmTurnEconomyPolicy(baseEconomy, {
    route: `social.${options.platform}.media_reply`,
    platform: options.platform,
    intent: "media",
  });
  const history = await db.getMessagesByPersonaId(options.binding.personaId, economy.context.historyFetchLimit);
  const lifeGate = applyIncomingLifeState(
    persona.personaData,
    [mediaLabel(options.media), caption || ""].filter(Boolean).join(" "),
    now,
  );
  if (lifeGate.changed) {
    await db.updatePersona(options.binding.personaId, options.binding.userId, {
      personaData: lifeGate.personaData,
    });
  }
  if (lifeGate.suppress) {
    console.info(`[SocialMediaChat] Suppressed immediate reply for persona ${persona.id}: ${lifeGate.reason} (${lifeGate.state.start}-${lifeGate.state.end} ${lifeGate.state.label})`);
    return null;
  }
  const personaForPrompt = lifeGate.changed
    ? { ...persona, personaData: lifeGate.personaData }
    : persona;
  const outputPreference = resolveRuntimeOutputPreference(options);
  const turnPlan = planPersonaTurn({
    platform: options.platform,
    inputText: [mediaLabel(options.media), caption || ""].filter(Boolean).join(" "),
    isMedia: true,
    recentMessages: history.slice(-economy.context.continuityRecentLimit),
    personaData: personaForPrompt.personaData,
    outputPreference,
    now,
  });
  console.info(
    `[PersonaTurn] platform=${turnPlan.platform} intent=${turnPlan.intent} memory=${turnPlan.memoryMode} activity=${turnPlan.currentActivity} replyLength=${turnPlan.replyLength} risks=${turnPlan.risks.join(",")}`,
  );
  const memoryRecallContext = await buildPersonaMemoryRecallContext({
    personaId: options.binding.personaId,
    userId: options.binding.userId,
    messageText: [mediaLabel(options.media), caption || ""].filter(Boolean).join(" "),
    recentMessages: history.slice(-economy.context.recallRecentLimit),
    memoryMode: turnPlan.memoryMode,
    limit: economy.memoryRecall.maxMemories,
    maxDescriptionChars: economy.memoryRecall.maxDescriptionChars,
    userPronoun: getPersonaLifeConfig(personaForPrompt.personaData).userPronoun,
  });

  let pinnedFacts: string[] = [];
  try {
    pinnedFacts = await db.getPinnedMemoryFacts(options.binding.personaId, options.binding.userId);
  } catch {
    pinnedFacts = [];
  }
  const innerState = getEffectiveInnerState(personaForPrompt.personaData, options.binding.personaId, now);
  const systemPrompt = [
    buildSystemPrompt(personaForPrompt, {
      sceneOverlay: options.sceneOverlay,
      now,
      pinnedFacts,
      innerState,
    }),
    socialSystemPromptOverlay(options.platform),
    buildTurnPlanInstruction(turnPlan),
    buildConversationContinuityInstruction(history, persona.name, "reply", {
      recentLimit: economy.context.continuityRecentLimit,
      timelineLimit: economy.context.continuityTimelineLimit,
    }),
    memoryRecallContext,
  ].filter(Boolean).join("\n\n");
  const currentMediaInstruction = visionDescription
    ? mediaInstruction(options.platform, options.contactName, options.media, visionDescription)
    : noVisionInstruction(options.platform, options.contactName, options.media);
  const loopGuard = mediaReplyLoopGuard(history);
  const defaultConfig = await db.getDefaultLlmConfig(options.binding.userId);
  const extra = (defaultConfig?.extraConfig as any) || {};
  const provider = (persona as any).llmProvider || undefined;

  const llmHistory = history.slice(-economy.context.llmHistoryLimit).map(m => {
    if (m.id === userMessageId) {
      return {
        role: "user" as const,
        content: [loopGuard, currentMediaInstruction].filter(Boolean).join("\n\n"),
      };
    }
    return {
      role: m.role as "user" | "assistant",
      content: m.content,
    };
  });

  const response = await llmService.invoke({
    messages: [
      { role: "system", content: systemPrompt },
      ...llmHistory,
    ],
    options: {
      provider,
      temperature: extra.temperature,
      maxTokens: extra.maxTokens,
      purpose: "media_reply",
      userId: options.binding.userId,
      personaId: options.binding.personaId,
      route: `social.${options.platform}.media_reply`,
    },
  });

  const replyText = cleanAssistantReply(response);
  // 媒体也是真实用户回合：演进延续内心状态并派生兼容标签（mood 续接、强度小幅抬升）。
  const nextInnerState = evolveInnerState(innerState, { intent: turnPlan.intent }, now);
  const newState = deriveEmotionalLabel(nextInnerState);

  const assistantMessageId = await db.createMessage({
    personaId: options.binding.personaId,
    userId: options.binding.userId,
    role: "assistant",
    content: replyText,
    emotionalState: newState,
    channel: resolveRuntimeChannel(options),
  });

  const runtimeDiagnostics = {
    lastTurnAt: now.toISOString(),
    platform: options.platform,
    channel: resolveRuntimeChannel(options),
    mode: "reply",
    inputPreview: userContent.slice(0, 240),
    replyPreview: replyText.slice(0, 240),
    mediaKind: options.media.kind,
    mediaUrl: url,
    turnPlan,
    economy: {
      level: economy.level,
      context: economy.context,
      memoryRecall: economy.memoryRecall,
      recallDegradation: economy.recallDegradation,
    },
    memoryRecallUsed: Boolean(memoryRecallContext),
    visionUsed: Boolean(visionDescription),
  };

  await db.updatePersona(options.binding.personaId, options.binding.userId, {
    chatCount: (persona.chatCount || 0) + 1,
    lastChatAt: now,
    emotionalState: newState as any,
    personaData: withPersonaRuntimeInnerState(
      withPersonaRuntimeDiagnostics(personaForPrompt.personaData, runtimeDiagnostics),
      nextInnerState,
    ),
  });

  return {
    replyText,
    emotionalState: newState,
    userMessageId,
    assistantMessageId,
    mediaUrl: url,
  };
}

export async function handleSocialPersonaMediaChat(options: SocialPersonaMediaChatOptions): Promise<string | null> {
  const result = await handleSocialPersonaMediaChatDetailed(options);
  return result?.replyText ?? null;
}
