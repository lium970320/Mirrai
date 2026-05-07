import type { WechatyInterface } from "wechaty/impls";
import { handlePersonaChat } from "./persona-bridge";

export async function handleWeChatMessage(msg: any, bot: WechatyInterface) {
  const contact = msg.talker();
  const isText = msg.type() === bot.Message.Type.Text;
  if (!isText) return;
  if (contact.self()) return;

  const room = msg.room();
  if (room) return; // only handle private messages for persona chat

  const contactId = contact.id;
  const contactName = await contact.name();
  const content = msg.text().trim();
  if (!content) return;

  console.log(`[WeChat] Incoming private text from ${contactName} (${contactId})`);
  const reply = await handlePersonaChat(contactId, contactName, content);
  if (reply) {
    await contact.say(reply);
    console.log(`[WeChat] Replied to ${contactName} (${contactId})`);
  } else {
    console.warn(`[WeChat] No reply generated for ${contactName} (${contactId})`);
  }
}
