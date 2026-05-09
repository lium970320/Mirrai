import { llmService } from "../llm";
import * as db from "../db";
import { ENV } from "../_core/env";
import { computeEmotionalState, buildSystemPrompt } from "../_core/persona-utils";
import { cleanAssistantReply } from "../_core/reply-utils";

export type QqPersonaChatOptions = {
  batchMessageCount?: number;
  batchMessages?: string[];
};

function qqTextInstruction(contactName: string, messageText: string, options: QqPersonaChatOptions): string {
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
    ].join("\n\n");
  }

  return [
    messageText,
    "【本轮回复节奏】根据用户这句话本身决定长短。普通寒暄、简单问题或日常报平安，短答即可；不要为了显得热情而补很多无关内容。只有需要安慰、解释或认真讨论时才展开。",
  ].join("\n\n");
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
  const systemPrompt = buildSystemPrompt(persona);
  const llmHistory = history.slice(-19).map(m => {
    if (m.id === userMessageId) {
      return {
        role: "user" as const,
        content: qqTextInstruction(contactName, messageText, options),
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
