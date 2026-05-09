import { llmService } from "../llm";
import * as db from "../db";
import { ENV } from "../_core/env";
import { computeEmotionalState, buildSystemPrompt } from "../_core/persona-utils";
import { cleanAssistantReply } from "../_core/reply-utils";

export type QqPersonaChatOptions = {
  batchMessageCount?: number;
  batchMessages?: string[];
};

type RecentConversationContext = {
  previousUser?: string;
  previousAssistant?: string;
};

function qqSystemPromptOverlay(): string {
  return [
    "【QQ 接入规则】QQ 只是同一个人物的另一个聊天入口，不是新身份、新关系或新时间线。",
    "你必须沿用网页/微信里的同一套人物设定、共同经历、称呼习惯、异地背景和情感进展。不要因为平台变成 QQ，就突然变得像客服、家长、机器人或另一个人。",
    "contactName 只是 QQ 昵称或群名，不代表对方希望你这样称呼。优先使用人物资料和既有对话里稳定的称呼，不要主动叫对方 QQ 昵称。",
    "对极短消息要看上一轮语境。像“没”“嗯”“好”“1”“啊”这种短句，通常是在回应上一句话，不要强行展开新话题，不要替对方补出过多动机；轻轻接住一句，必要时追问即可。",
    "回复节奏保持微信里的自然私聊感：能一句说清就一句，不要每次都关心、说教、催睡或总结；只有对方明显需要安慰、解释或认真讨论时才展开。",
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

function qqTextInstruction(
  contactName: string,
  messageText: string,
  options: QqPersonaChatOptions,
  context: RecentConversationContext,
): string {
  const sender = contactName || "对方";
  const batchMessageCount = Math.max(1, options.batchMessageCount ?? 1);
  const continuousText = (options.batchMessages?.length ? options.batchMessages : [messageText])
    .map(message => message.trim())
    .filter(Boolean)
    .join("\n");

  if (batchMessageCount > 1) {
    return [
      `${sender}刚刚连续发来 ${batchMessageCount} 条 QQ 消息。请把它们当成同一段连续话语：后一句通常是在补充、推进或修正前一句，不是多个独立问题。`,
      `连续话语原文：\n${continuousText}`,
      "理解规则：先在心里把这些短句连成一个完整意思，再只围绕这个完整意思回应；不要按行逐条回答，也不要逐条反驳。",
      "时间规则：如果前一句给出了“中考的时候”“那时候”“之前”“当年”等过去时间框架，后面的短句默认继承这个时间框架。不要拿当前武汉-南京异地设定去否定过去回忆。",
      "边界规则：如果回忆发生在中考、学校时期或明显未成年阶段，涉及睡在一起、抱、摸等身体亲近内容时，只能按紧张、依赖、照顾、孩子气玩笑或记忆偏差来含蓄处理，不要色情化，不要扩写身体细节。",
      "本轮回复节奏：普通寒暄、简单提问、报平安、吃没吃这类日常问题，1-2句即可；只有对方明显需要安慰、解释或认真讨论时才多说。不要补很多无关关心。",
      "平台一致性：这只是 QQ 入口，语气、称呼、记忆和关系进展要和微信里一致。",
    ].join("\n\n");
  }

  if (isAmbiguousShortReply(messageText)) {
    return [
      shortReplyDisambiguationInstruction(messageText, context),
      "【平台一致性】这只是 QQ 入口，语气、称呼、记忆和关系进展要和微信里一致。不要提平台，也不要像新认识的人一样重新建立关系。",
    ].join("\n\n");
  }

  return [
    messageText,
    "【平台一致性】这只是 QQ 入口，语气、称呼、记忆和关系进展要和微信里一致。不要提平台，也不要像新认识的人一样重新建立关系。",
    "【短句理解】如果这句话很短，例如“没”“嗯”“好”“1”“啊”，先结合上一轮上下文理解成接话，不要另起场景，不要强行催睡、说教或补很多关心。",
    "【本轮回复节奏】根据用户这句话本身决定长短。普通寒暄、简单问题或日常报平安，短答即可；不要为了显得热情而补很多无关内容。只有需要安慰、解释或认真讨论时才展开。",
  ].join("\n\n");
}

function getRecentConversationContext(messages: Array<{ id: number; role: string; content: string }>, currentMessageId: number): RecentConversationContext {
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

async function resolveQqBinding(contactId: string, contactName: string) {
  const existing = await db.getQqBindingByContactId(contactId);
  if (existing) return existing;
  if (!db.QQ_CONTACT_PREFIX || !contactId.startsWith(db.QQ_CONTACT_PREFIX)) return undefined;
  if (!ENV.qqAutoBindSingleReadyPersona) return undefined;

  const persona = await db.getSingleReadyPersonaForWechatAutoBind();
  if (!persona) return undefined;

  await db.createQqBinding({
    personaId: persona.id,
    userId: persona.userId,
    qqContactId: contactId,
    qqName: contactName,
  });

  console.info(`[QQ] Auto-bound ${contactId} to persona=${persona.id}`);
  return db.getQqBindingByContactId(contactId);
}

export async function handleQqPersonaChat(
  contactId: string,
  contactName: string,
  messageText: string,
  options: QqPersonaChatOptions = {},
): Promise<string | null> {
  const binding = await resolveQqBinding(contactId, contactName);
  if (!binding) return null;

  const persona = await db.getPersonaById(binding.personaId, binding.userId);
  if (!persona || persona.analysisStatus !== "ready") return null;

  const userMessageId = await db.createMessage({
    personaId: binding.personaId,
    userId: binding.userId,
    role: "user",
    content: messageText,
    emotionalState: persona.emotionalState,
  });

  const history = await db.getMessagesByPersonaId(binding.personaId, 20);
  const systemPrompt = `${buildSystemPrompt(persona)}\n\n${qqSystemPromptOverlay()}`;
  const recentContext = getRecentConversationContext(history, userMessageId);
  const llmHistory = history.slice(-19).map(m => {
    if (m.id === userMessageId) {
      return {
        role: "user" as const,
        content: qqTextInstruction(contactName, messageText, options, recentContext),
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
  });
  const replyText = cleanAssistantReply(response);
  const newState = computeEmotionalState(messageText, replyText, persona.emotionalState);

  await db.createMessage({
    personaId: binding.personaId,
    userId: binding.userId,
    role: "assistant",
    content: replyText,
    emotionalState: newState,
  });

  await db.updatePersona(binding.personaId, binding.userId, {
    chatCount: (persona.chatCount || 0) + 1,
    lastChatAt: new Date(),
    emotionalState: newState as any,
  });

  return replyText;
}
