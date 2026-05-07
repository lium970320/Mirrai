import { llmService } from "../llm";
import * as db from "../db";
import { ENV } from "../_core/env";
import { computeEmotionalState, buildSystemPrompt } from "../_core/persona-utils";
import { stripLeadingAsides } from "../_core/reply-utils";

export async function handlePersonaChat(
  contactId: string,
  contactName: string,
  messageText: string,
): Promise<string | null> {
  let binding = await db.getWechatBindingByContactId(contactId);
  if (!binding && ENV.wechatAutoBindSingleReadyPersona) {
    const persona = await db.getSingleReadyPersonaForWechatAutoBind();
    if (persona) {
      const bindingId = await db.createWechatBinding({
        userId: persona.userId,
        personaId: persona.id,
        wechatContactId: contactId,
        wechatName: contactName,
        isActive: true,
      });
      binding = {
        id: bindingId,
        userId: persona.userId,
        personaId: persona.id,
        wechatContactId: contactId,
        wechatName: contactName,
        wechatAlias: null,
        isActive: true,
        createdAt: new Date(),
      };
      console.log(
        `[WeChat] Auto-bound ${contactName} (${contactId}) to persona ${persona.name} (${persona.id})`
      );
    }
  }

  if (!binding) {
    console.warn(
      `[WeChat] No active binding for ${contactName} (${contactId}); cannot choose a persona`
    );
    return null;
  }

  const persona = await db.getPersonaById(binding.personaId, binding.userId);
  if (!persona || persona.analysisStatus !== "ready") {
    console.warn(
      `[WeChat] Bound persona ${binding.personaId} is missing or not ready for ${contactName} (${contactId})`
    );
    return null;
  }

  await db.createMessage({
    personaId: binding.personaId,
    userId: binding.userId,
    role: "user",
    content: messageText,
    emotionalState: persona.emotionalState,
    channel: "wechat",
  });

  const history = await db.getMessagesByPersonaId(binding.personaId, 20);
  const systemPrompt = buildSystemPrompt(persona);

  const response = await llmService.invoke({
    messages: [
      { role: "system", content: systemPrompt },
      ...history.slice(-19).map(m => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    ],
  });
  const replyText = stripLeadingAsides(response || "（沉默）");

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
