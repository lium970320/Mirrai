import * as db from "../db";
import { ENV } from "../_core/env";
import { handleSocialPersonaTextChat } from "../social/persona-text-chat";

export type QqPersonaChatOptions = {
  batchMessageCount?: number;
  batchMessages?: string[];
};

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

  return handleSocialPersonaTextChat({
    platform: "qq",
    binding,
    contactName,
    messageText,
    batchMessageCount: options.batchMessageCount,
    batchMessages: options.batchMessages,
    channel: "web",
  });
}
