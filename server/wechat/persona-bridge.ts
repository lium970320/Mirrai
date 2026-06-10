import * as db from "../db";
import { handleSocialPersonaMediaChat, type SocialMediaInput } from "../social/persona-media-chat";
import { handleSocialPersonaTextChat } from "../social/persona-text-chat";
import { defaultOutputPreferenceForPlatform } from "../social/runtime-request";

export type WeChatMediaInput = SocialMediaInput;

export type WeChatPersonaChatOptions = {
  batchMessageCount?: number;
  batchMessages?: string[];
  shouldAbortReply?: () => boolean;
};

export async function handlePersonaChat(
  contactId: string,
  contactName: string,
  messageText: string,
  options: WeChatPersonaChatOptions = {},
): Promise<string | null> {
  const binding = await db.getWechatBindingByContactId(contactId);
  if (!binding) return null;

  return handleSocialPersonaTextChat({
    platform: "wechat",
    binding,
    contactName,
    messageText,
    batchMessageCount: options.batchMessageCount,
    batchMessages: options.batchMessages,
    shouldAbortReply: options.shouldAbortReply,
    channel: "wechat",
    outputPreference: defaultOutputPreferenceForPlatform("wechat"),
  });
}

export async function handlePersonaMediaChat(
  contactId: string,
  contactName: string,
  media: WeChatMediaInput,
): Promise<string | null> {
  const binding = await db.getWechatBindingByContactId(contactId);
  if (!binding) return null;

  return handleSocialPersonaMediaChat({
    platform: "wechat",
    binding,
    contactName,
    media,
    channel: "wechat",
    storagePrefix: "wechat",
    outputPreference: defaultOutputPreferenceForPlatform("wechat"),
  });
}
