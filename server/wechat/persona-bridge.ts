import { llmService } from "../llm";
import * as db from "../db";
import { getEmotionalStateDesc, computeEmotionalState, buildSystemPrompt } from "../_core/persona-utils";
import { storagePut } from "../storage";
import { nanoid } from "nanoid";
import { describeImage } from "../vision";
import { cleanAssistantReply } from "../_core/reply-utils";

export type WeChatMediaInput = {
  kind: "image" | "emoticon";
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  sourceUrl?: string;
};

export type WeChatPersonaChatOptions = {
  batchMessageCount?: number;
  batchMessages?: string[];
};

function sanitizeStorageName(fileName: string): string {
  return fileName.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim() || "wechat-image.jpg";
}

function mediaLabel(kind: WeChatMediaInput["kind"]): string {
  return kind === "emoticon" ? "[表情包]" : "[图片]";
}

function mediaInstruction(contactName: string, media: WeChatMediaInput, description: string): string {
  const sender = contactName || "对方";
  const label = media.kind === "emoticon" ? "微信表情包" : "图片";
  return `${sender}发来了一张${label}。视觉模型识别结果如下：\n${description}\n\n请只根据这段识别结果和上下文，用你的人格口吻自然回应。不要写成图片说明，也不要说自己是AI。`;
}

function noVisionInstruction(contactName: string, media: WeChatMediaInput): string {
  const sender = contactName || "对方";
  if (media.kind === "emoticon") {
    return `${sender}发来了一张微信表情包，但这次没有识别到具体画面。请不要编造画面细节，不要说自己看不见，也不要提AI、视觉模型或技术问题；只把它当作对方用表情包接话，用你的人格口吻自然回应，可以温柔地接住、轻轻调侃，或顺势问一句。`;
  }
  return `${sender}发来了一张图片，但这次没有识别到具体画面。请不要编造画面细节，不要说自己看不见，也不要提AI、视觉模型或技术问题；用你的人格口吻自然接住这条消息，可以温柔地回应，或顺势问一句。`;
}

function wechatTextInstruction(contactName: string, messageText: string, options: WeChatPersonaChatOptions): string {
  const sender = contactName || "对方";
  const batchMessageCount = Math.max(1, options.batchMessageCount ?? 1);
  const continuousText = (options.batchMessages?.length ? options.batchMessages : [messageText])
    .map(message => message.trim())
    .filter(Boolean)
    .join("\n");

  if (batchMessageCount > 1) {
    return [
      `${sender}刚刚连续发来 ${batchMessageCount} 条微信消息。请把它们当成同一段连续话语：后一句通常是在补充、推进或修正前一句，不是多个独立问题。`,
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

export async function handlePersonaChat(
  contactId: string,
  contactName: string,
  messageText: string,
  options: WeChatPersonaChatOptions = {},
): Promise<string | null> {
  const binding = await db.getWechatBindingByContactId(contactId);
  if (!binding) return null;

  const persona = await db.getPersonaById(binding.personaId, binding.userId);
  if (!persona || persona.analysisStatus !== "ready") return null;

  const userMessageId = await db.createMessage({
    personaId: binding.personaId,
    userId: binding.userId,
    role: "user",
    content: messageText,
    emotionalState: persona.emotionalState,
    channel: "wechat",
  });

  const history = await db.getMessagesByPersonaId(binding.personaId, 20);
  const systemPrompt = buildSystemPrompt(persona);
  const llmHistory = history.slice(-19).map(m => {
    if (m.id === userMessageId) {
      return {
        role: "user" as const,
        content: wechatTextInstruction(contactName, messageText, options),
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
    channel: "wechat",
  });

  await db.updatePersona(binding.personaId, binding.userId, {
    chatCount: (persona.chatCount || 0) + 1,
    lastChatAt: new Date(),
    emotionalState: newState as any,
  });

  return replyText;
}

export async function handlePersonaMediaChat(
  contactId: string,
  contactName: string,
  media: WeChatMediaInput,
): Promise<string | null> {
  const binding = await db.getWechatBindingByContactId(contactId);
  if (!binding) return null;

  const persona = await db.getPersonaById(binding.personaId, binding.userId);
  if (!persona || persona.analysisStatus !== "ready") return null;

  let url: string | undefined;
  if (media.buffer.byteLength > 0) {
    const safeFileName = sanitizeStorageName(media.fileName);
    const fileKey = `wechat/${binding.userId}/${binding.personaId}/${nanoid()}-${safeFileName}`;
    ({ url } = await storagePut(fileKey, media.buffer, media.mimeType));
  }
  const label = mediaLabel(media.kind);
  let visionDescription: string | null = null;
  try {
    visionDescription = await describeImage(media);
  } catch (err) {
    console.warn("[WeChat] Vision description failed:", err);
  }
  const userContent = visionDescription
    ? `${label}\n${visionDescription}`
    : label;

  const userMessageId = await db.createMessage({
    personaId: binding.personaId,
    userId: binding.userId,
    role: "user",
    content: userContent,
    messageType: "image",
    mediaUrl: url,
    emotionalState: persona.emotionalState,
    channel: "wechat",
  });

  const history = await db.getMessagesByPersonaId(binding.personaId, 20);
  const systemPrompt = buildSystemPrompt(persona);
  const currentMediaInstruction = visionDescription
    ? mediaInstruction(contactName, media, visionDescription)
    : noVisionInstruction(contactName, media);

  const llmHistory = history.slice(-19).map(m => {
    if (m.id === userMessageId) {
      return {
        role: "user" as const,
        content: currentMediaInstruction,
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
  const newState = computeEmotionalState(label, replyText, persona.emotionalState);

  await db.createMessage({
    personaId: binding.personaId,
    userId: binding.userId,
    role: "assistant",
    content: replyText,
    emotionalState: newState,
    channel: "wechat",
  });

  await db.updatePersona(binding.personaId, binding.userId, {
    chatCount: (persona.chatCount || 0) + 1,
    lastChatAt: new Date(),
    emotionalState: newState as any,
  });

  return replyText;
}
