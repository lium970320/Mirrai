import { llmService } from "../llm";
import * as db from "../db";
import { applyIncomingLifeState } from "../_core/life-schedule";
import { computeEmotionalState, buildSystemPrompt } from "../_core/persona-utils";
import { cleanAssistantReply } from "../_core/reply-utils";
import { buildConversationContinuityInstruction } from "./conversation-continuity";
import { buildPersonaSourceRecallContext } from "./source-recall";
import {
  enforceSourceGroundedReply,
  sourceGroundedLlmOptions,
  withSourceGroundingInstruction,
} from "./source-grounding";

export type SocialPlatform = "wechat" | "qq";

export type SocialPersonaTextChatOptions = {
  platform: SocialPlatform;
  binding: {
    personaId: number;
    userId: number;
  };
  contactName: string;
  messageText: string;
  batchMessageCount?: number;
  batchMessages?: string[];
  channel?: "web" | "wechat";
  shouldAbortReply?: () => boolean;
};

type RecentConversationContext = {
  previousUser?: string;
  previousAssistant?: string;
};

function platformLabel(platform: SocialPlatform): string {
  return platform === "qq" ? "QQ" : "微信";
}

function socialSystemPromptOverlay(platform: SocialPlatform): string {
  const label = platformLabel(platform);
  return [
    `【${label} 接入规则】${label} 只是同一个人物的另一个聊天入口，不是新身份、新关系或新时间线。`,
    "你必须沿用网页、微信和其他入口里的同一套人物设定、共同经历、称呼习惯、异地背景和情感进展。",
    "contactName 只是平台昵称或群名，不代表对方希望你这样称呼。优先使用人物资料和既有对话里稳定的称呼。",
    "默认用自然的简体中文回复，除非用户明确要求英文或其他语言。",
    "不要用剧本格式、角色名加冒号或“王芃泽：”“敏子：”这种台词格式开头；直接像真人聊天一样说。",
    "对极短消息要看上一轮语境。像“没”“嗯”“好”“1”“啊”这种短句，通常是在回应上一句话，不要强行展开新话题，不要替对方补出过多动机。",
    "回复节奏保持自然私聊感：能一句说清就一句，不要每次都关心、说教、催睡或总结；只有对方明显需要安慰、解释或认真讨论时才展开。",
  ].join("\n");
}

function isAmbiguousShortReply(text: string): boolean {
  const normalized = text
    .replace(/\s+/g, "")
    .replace(/[。！？!?…,.，、~～]+$/g, "");
  if (!normalized) return false;
  if (Array.from(normalized).length <= 2) return true;
  return /^(没|没有|不是|不|嗯|啊|哦|好|行|可以|算了|1|收到|测试|在)$/.test(normalized);
}

function isExplicitVoiceRequest(text: string): boolean {
  return /语音回|发语音|用语音|说出来|念出来|读出来|用声音/.test(text);
}

function recentContextBlock(context: RecentConversationContext): string {
  const lines = [];
  if (context.previousUser) {
    lines.push(`上一条用户消息：${context.previousUser}`);
  }
  if (context.previousAssistant) {
    lines.push(`上一条角色回复：${context.previousAssistant}`);
  }
  return lines.join("\n");
}

function sleepLoopGuardInstruction(messageText: string, context: RecentConversationContext): string {
  const previousAssistant = context.previousAssistant ?? "";
  const userMentionsSleep = /睡|困|熬夜|晚安|休息|起床|明天|上课|上班/.test(messageText);
  const previousPushedSleep = /睡|休息|熬夜|明天|上课|躺|困/.test(previousAssistant);
  const userNeedsRepair = /冷漠|敷衍|不理|生气|委屈|呜呜|难过|不理你|不想理/.test(messageText);

  const lines: string[] = [];
  if (previousPushedSleep && !userMentionsSleep) {
    lines.push("【话题防循环】上一轮已经把话题收束到睡觉、休息或明天安排，本轮不要再催睡、说“明天给我发消息”或继续关闭话题；先回应用户这句话本身。");
  }
  if (userNeedsRepair) {
    lines.push("【关系修复】用户像是在撒娇、委屈或抱怨你冷漠。不要敷衍，不要把对话赶去睡觉；用一两句接住情绪，可以轻轻认错或解释关心，但保持王芃泽式克制。");
  }
  return lines.join("\n");
}

function shortReplyDisambiguationInstruction(messageText: string, context: RecentConversationContext): string {
  const contextText = recentContextBlock(context);
  return [
    "【短句消歧】用户本轮是短回复，不要按孤立字面理解，必须先判断它在回应上一条里的哪一个问题、推测或话头。",
    contextText ? `最近上下文：\n${contextText}` : "最近上下文：无可用上一轮内容。",
    `用户本轮短回复：${messageText}`,
    "判定规则：",
    "1. “没/没有/不是/不”优先否定上一条角色回复里最后一个明确问题或推测。例如上一句是“你怎么还不睡，明天打算赖床？”，用户回“没”，意思是“没有打算赖床”，不是“没有睡”。",
    "2. “1/测试/收到”通常只是测试链路或简单确认。只需要自然确认，不要自动转成催睡、关心、道别或新话题。",
    "3. 如果上一句里有多个可被否定的对象，选择最近、最具体、最像问句的那个；不确定时就用一句话轻轻确认，不要擅自补剧情。",
    "4. 回复要接着上一轮走，短一点，像真实聊天；不要为了完整而解释自己如何理解短句。",
  ].filter(Boolean).join("\n");
}

export function buildSocialTextInstruction(
  platform: SocialPlatform,
  contactName: string,
  messageText: string,
  options: Pick<SocialPersonaTextChatOptions, "batchMessageCount" | "batchMessages">,
  context: RecentConversationContext = {},
): string {
  const label = platformLabel(platform);
  const sender = contactName || "对方";
  const batchMessageCount = Math.max(1, options.batchMessageCount ?? 1);
  const continuousText = (options.batchMessages?.length ? options.batchMessages : [messageText])
    .map(message => message.trim())
    .filter(Boolean)
    .join("\n");
  const voiceRequestInstruction = isExplicitVoiceRequest(continuousText)
    ? "【语音回复约束】用户明确要求语音。本轮回复会被合成一条语音，所以请写成 10 秒内能说完的短口语回复，最好 1-2 句、45 字以内；不要写长段、列表、解释稿或多个话题。"
    : "";

  if (batchMessageCount > 1) {
    return [
      sleepLoopGuardInstruction(continuousText, context),
      voiceRequestInstruction,
      `${sender}刚刚连续发来 ${batchMessageCount} 条${label}消息。请把它们当成同一段连续话语：后一句通常是在补充、推进或修正前一句，不是多个独立问题。`,
      `连续话语原文：\n${continuousText}`,
      "理解规则：先在心里把这些短句连成一个完整意思，再只围绕这个完整意思回应；不要按行逐条回答，也不要逐条反驳。",
      "时间规则：如果前一句给出了“中考的时候”“那时候”“之前”“当年”等过去时间框架，后面的短句默认继承这个时间框架。不要拿当前武汉-南京异地设定去否定过去回忆。",
      "边界规则：如果回忆发生在中考、学校时期或明显未成年阶段，涉及睡在一起、抱、摸等身体亲近内容时，只能按紧张、依赖、照顾、孩子气玩笑或记忆偏差来含蓄处理，不要色情化，不要扩写身体细节。",
      "发送规则：本轮只生成一次综合回复，不要像补旧账一样为每一条消息分别生成一段；如果有没来得及回应的前文，也合并进这一轮的一两句里。",
      "本轮回复节奏：普通寒暄、简单提问、报平安、吃没吃这类日常问题，1-2句即可；只有对方明显需要安慰、解释或认真讨论时才多说。不要补很多无关关心。",
      `平台一致性：这只是${label}入口，语气、称呼、记忆和关系进展要和其他入口一致。`,
    ].filter(Boolean).join("\n\n");
  }

  if (isAmbiguousShortReply(messageText)) {
    return [
      sleepLoopGuardInstruction(messageText, context),
      voiceRequestInstruction,
      shortReplyDisambiguationInstruction(messageText, context),
      `【平台一致性】这只是${label}入口，语气、称呼、记忆和关系进展要和其他入口一致。不要提平台，也不要像新认识的人一样重新建立关系。`,
    ].filter(Boolean).join("\n\n");
  }

  return [
    sleepLoopGuardInstruction(messageText, context),
    voiceRequestInstruction,
    messageText,
    `【平台一致性】这只是${label}入口，语气、称呼、记忆和关系进展要和其他入口一致。不要提平台，也不要像新认识的人一样重新建立关系。`,
    "【短句理解】如果这句话很短，例如“没”“嗯”“好”“1”“啊”，先结合上一轮上下文理解成接话，不要另起场景，不要强行催睡、说教或补很多关心。",
    "【本轮回复节奏】根据用户这句话本身决定长短。普通寒暄、简单问题或日常报平安，短答即可；不要为了显得热情而补很多无关内容。只有需要安慰、解释或认真讨论时才展开。",
  ].filter(Boolean).join("\n\n");
}

export function getRecentConversationContext(
  messages: Array<{ id: number; role: string; content: string }>,
  currentMessageId: number,
): RecentConversationContext {
  const previousMessages = messages.filter(message => message.id !== currentMessageId);
  const context: RecentConversationContext = {};

  for (let index = previousMessages.length - 1; index >= 0; index -= 1) {
    const message = previousMessages[index];
    if (!context.previousAssistant && message.role === "assistant") {
      context.previousAssistant = message.content;
    } else if (!context.previousUser && message.role === "user") {
      context.previousUser = message.content;
    }

    if (context.previousAssistant && context.previousUser) break;
  }

  return context;
}

function shouldAbortPendingReply(options: SocialPersonaTextChatOptions, personaId: number, stage: string): boolean {
  if (!options.shouldAbortReply) return false;
  try {
    const aborted = options.shouldAbortReply();
    if (aborted) {
      console.info(`[SocialChat] Discarded stale reply for persona ${personaId} at ${stage}; newer user message is pending.`);
    }
    return aborted;
  } catch (err) {
    console.warn(`[SocialChat] Stale-reply guard failed for persona ${personaId} at ${stage}:`, err);
    return false;
  }
}

export async function handleSocialPersonaTextChat(options: SocialPersonaTextChatOptions): Promise<string | null> {
  const persona = await db.getPersonaById(options.binding.personaId, options.binding.userId);
  if (!persona || persona.analysisStatus !== "ready") return null;

  const userMessageId = await db.createMessage({
    personaId: options.binding.personaId,
    userId: options.binding.userId,
    role: "user",
    content: options.messageText,
    emotionalState: persona.emotionalState,
    channel: options.channel ?? "web",
  });

  const history = await db.getMessagesByPersonaId(options.binding.personaId, 20);
  const lifeGate = applyIncomingLifeState(persona.personaData, options.messageText);
  if (lifeGate.changed) {
    await db.updatePersona(options.binding.personaId, options.binding.userId, {
      personaData: lifeGate.personaData,
    });
  }
  if (lifeGate.suppress) {
    console.info(`[SocialChat] Suppressed immediate reply for persona ${persona.id}: ${lifeGate.reason} (${lifeGate.state.start}-${lifeGate.state.end} ${lifeGate.state.label})`);
    return null;
  }
  if (shouldAbortPendingReply(options, persona.id, "before_llm")) {
    return null;
  }
  const personaForPrompt = lifeGate.changed
    ? { ...persona, personaData: lifeGate.personaData }
    : persona;

  const defaultConfig = await db.getDefaultLlmConfig(options.binding.userId);
  const extra = (defaultConfig?.extraConfig as any) || {};
  const provider = (persona as any).llmProvider || undefined;
  const baseLlmOptions = {
    provider,
    temperature: extra.temperature,
    maxTokens: extra.maxTokens,
  };
  const sourceRecallContext = await buildPersonaSourceRecallContext({
    personaId: options.binding.personaId,
    userId: options.binding.userId,
    messageText: options.messageText,
    recentMessages: history.slice(-8),
  });
  const systemPrompt = [
    buildSystemPrompt(personaForPrompt),
    socialSystemPromptOverlay(options.platform),
    buildConversationContinuityInstruction(history, persona.name, "reply"),
    sourceRecallContext,
  ].filter(Boolean).join("\n\n");
  const recentContext = getRecentConversationContext(history, userMessageId);
  const llmHistory = history.slice(-19).map(m => {
    if (m.id === userMessageId) {
      const baseInstruction = buildSocialTextInstruction(
        options.platform,
        options.contactName,
        options.messageText,
        options,
        recentContext,
      );

      return {
        role: "user" as const,
        content: withSourceGroundingInstruction(baseInstruction, sourceRecallContext),
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
    options: sourceRecallContext
      ? sourceGroundedLlmOptions(baseLlmOptions)
      : baseLlmOptions,
  });
  const draftReply = cleanAssistantReply(response);
  if (shouldAbortPendingReply(options, persona.id, "after_llm")) {
    return null;
  }
  const replyText = sourceRecallContext
    ? await enforceSourceGroundedReply({
      personaName: persona.name,
      userQuestion: options.messageText,
      sourceContext: sourceRecallContext,
      draftReply,
      llmOptions: baseLlmOptions,
    })
    : draftReply;
  if (shouldAbortPendingReply(options, persona.id, "before_persist")) {
    return null;
  }
  const newState = computeEmotionalState(options.messageText, replyText, persona.emotionalState);

  await db.createMessage({
    personaId: options.binding.personaId,
    userId: options.binding.userId,
    role: "assistant",
    content: replyText,
    emotionalState: newState,
    channel: options.channel ?? "web",
  });

  await db.updatePersona(options.binding.personaId, options.binding.userId, {
    chatCount: (persona.chatCount || 0) + 1,
    lastChatAt: new Date(),
    emotionalState: newState as any,
  });

  return replyText;
}
