import * as db from "../db";
import { ENV } from "../_core/env";
import { handleSocialPersonaMediaChat, type SocialMediaInput } from "../social/persona-media-chat";
import {
  handleSocialPersonaTextChatDetailed,
  type SocialPersonaTextChatResult,
} from "../social/persona-text-chat";
import { defaultOutputPreferenceForPlatform } from "../social/runtime-request";
import { getSceneMode, getDualMode } from "./scene-commands";
import { wantsKeepGoing } from "../social/persona-turn-planner";

export type QqPersonaChatOptions = {
  batchMessageCount?: number;
  batchMessages?: string[];
  shouldAbortReply?: () => boolean;
  /** 允许人物在回复末尾输出 [[PHOTO|...]] 拍照意图标记（由 message-handler 按冷却门控） */
  allowPhotoIntent?: boolean;
};

export type QqMediaInput = SocialMediaInput;

async function resolveQqBinding(contactId: string, contactName: string) {
  const existing = await db.getQqBindingByContactId(contactId);
  if (existing) return existing;
  if (!db.QQ_CONTACT_PREFIX || !contactId.startsWith(db.QQ_CONTACT_PREFIX)) return undefined;
  if (!ENV.qqAutoBindSingleReadyPersona) return undefined;

  const persona = await db.getSingleReadyPersonaForQqAutoBind();
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

/** 取该分身当前激活场景的提示词覆盖（网页「场景模式」激活后写在 personas.activeSceneId）。 */
async function resolveSceneOverlay(personaId: number, userId: number): Promise<string | null> {
  const persona = await db.getPersonaById(personaId, userId);
  const sceneId = (persona as any)?.activeSceneId;
  if (!sceneId) return null;
  const scene = await db.getSceneById(sceneId);
  return scene?.systemPromptOverlay ?? null;
}

export async function handleQqPersonaChat(
  contactId: string,
  contactName: string,
  messageText: string,
  options: QqPersonaChatOptions = {},
): Promise<string | null> {
  const result = await handleQqPersonaChatDetailed(contactId, contactName, messageText, options);
  return result?.replyText ?? null;
}

export async function handleQqPersonaChatDetailed(
  contactId: string,
  contactName: string,
  messageText: string,
  options: QqPersonaChatOptions = {},
): Promise<SocialPersonaTextChatResult | null> {
  const binding = await resolveQqBinding(contactId, contactName);
  if (!binding) return null;

  const sceneOverlay = await resolveSceneOverlay(binding.personaId, binding.userId);
  // 沉浸真相 = 内存 getSceneMode（QQ「场景模式」开关，进程内）或 DB activeSceneId（网页/背景场景，持久）任一为真，
  // 在此实时合成 immersiveMode 一处算清，随 result.immersiveMode 回传发送层据此拆条/写交付句。
  // 不再「sceneOverlay!=null 就回灌 setSceneMode(true)」：那是单向只开，网页取消场景（只清 DB、不碰内存）后
  // 内存仍残留 true → 「已退出场景却仍出【】」。重启恢复也无需回灌——sceneOverlay 持久，本函数实时读到即为 true。
  const immersiveMode = getSceneMode(contactId) || sceneOverlay != null;
  return handleSocialPersonaTextChatDetailed({
    platform: "qq",
    binding,
    contactName,
    messageText,
    batchMessageCount: options.batchMessageCount,
    batchMessages: options.batchMessages,
    shouldAbortReply: options.shouldAbortReply,
    channel: "qq",
    sceneOverlay,
    outputPreference: defaultOutputPreferenceForPlatform("qq"),
    replyLengthOverride: immersiveMode ? "long" : undefined,
    immersiveMode,
    dualMode: immersiveMode && getDualMode(contactId),
    keepGoing: wantsKeepGoing(messageText),
    allowPhotoIntent: options.allowPhotoIntent,
  });
}

export async function handleQqPersonaMediaChat(
  contactId: string,
  contactName: string,
  media: QqMediaInput,
): Promise<string | null> {
  const binding = await resolveQqBinding(contactId, contactName);
  if (!binding) return null;

  const sceneOverlay = await resolveSceneOverlay(binding.personaId, binding.userId);
  const immersiveMode = getSceneMode(contactId) || sceneOverlay != null;
  return handleSocialPersonaMediaChat({
    platform: "qq",
    binding,
    contactName,
    media,
    channel: "qq",
    storagePrefix: "qq",
    sceneOverlay,
    outputPreference: defaultOutputPreferenceForPlatform("qq"),
    immersiveMode,
    dualMode: immersiveMode && getDualMode(contactId),
  });
}
