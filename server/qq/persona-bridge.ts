import * as db from "../db";
import { ENV } from "../_core/env";
import { handleSocialPersonaMediaChat, type SocialMediaInput } from "../social/persona-media-chat";
import {
  handleSocialPersonaTextChatDetailed,
  type SocialPersonaTextChatResult,
} from "../social/persona-text-chat";
import { defaultOutputPreferenceForPlatform } from "../social/runtime-request";
import { getVerboseMode } from "./verbose-commands";
import { getSceneMode, setSceneMode } from "./scene-commands";
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
  // 网页激活的背景场景（activeSceneId 持久化在 DB）重启后仍应是场景模式：从持久态回灌内存开关 getSceneMode，
  // 让发送层拆条（只认 getSceneMode）与生成层 immersiveMode（getSceneMode||sceneOverlay）用同一真相；
  // 否则进程重启丢内存态后会出现「保留【】却不压平拆条」→ 旁白排版错乱、与对话混段。
  if (sceneOverlay != null) setSceneMode(contactId, true);
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
    replyLengthOverride: (getVerboseMode(contactId) || getSceneMode(contactId) || sceneOverlay != null) ? "long" : undefined,
    immersiveMode: getSceneMode(contactId) || sceneOverlay != null,
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
  return handleSocialPersonaMediaChat({
    platform: "qq",
    binding,
    contactName,
    media,
    channel: "qq",
    storagePrefix: "qq",
    sceneOverlay,
    outputPreference: defaultOutputPreferenceForPlatform("qq"),
  });
}
