import { getActiveQqBindingsByPersonaId } from "../db";
import { getQqBotStatus, sendQqRecordFile, sendQqText } from "../qq/onebot-client";
import { generateTTSFile } from "../_core/tts";
import { markStickerSent, selectSticker } from "../stickers/sticker-selector";
import { sendQqSticker } from "../stickers/sticker-sender";
import type { StickerIntent } from "../stickers/sticker-intent";
import type { ProactiveModality } from "./proactive-multimodal";
import type { SocialRuntimeChannel, SocialRuntimePlatform } from "./runtime-request";

export type ProactivePreferredTarget = {
  channel: SocialRuntimeChannel;
  platform: Exclude<SocialRuntimePlatform, "web"> | null;
  qqBindings: Array<{ wechatContactId: string }>;
};

export type ProactiveDeliveryResult = {
  sent: boolean;
  channel: SocialRuntimeChannel;
  platform: "qq" | "wechat" | null;
  /** 实际发出的模态：语音/表情发送成功才记 voice/sticker，失败回退后记 text。 */
  modality?: ProactiveModality;
  reason?: string;
};

// 主动表情用的轻量基调：主动消息没有逐轮 turn plan，给一个温和日常的 intent；
// selectSticker 按 mood/tags/intensity 评分，命不中就只发文本（best-effort，不影响主文本）。
const PROACTIVE_STICKER_INTENT: StickerIntent = {
  shouldSend: true,
  mood: "陪伴",
  intensity: 2,
  tags: ["daily", "soft", "close"],
};

export async function resolveProactivePreferredTarget(
  persona: { id: number; userId: number },
): Promise<ProactivePreferredTarget> {
  const qqBindings = await getActiveQqBindingsByPersonaId(persona.id, persona.userId);
  if (qqBindings.length > 0) {
    return {
      channel: "qq",
      platform: "qq",
      qqBindings,
    };
  }

  return {
    channel: "web",
    platform: null,
    qqBindings: [],
  };
}

// 把一条主动消息按目标模态发到单个 QQ 联系人；语音/表情失败一律回退到纯文本。
async function deliverToQqContact(
  contactId: string,
  text: string,
  modality: ProactiveModality,
): Promise<{ sent: boolean; modality: ProactiveModality }> {
  if (modality === "voice") {
    try {
      const tts = await generateTTSFile(text);
      if (await sendQqRecordFile(contactId, tts.filePath)) {
        return { sent: true, modality: "voice" };
      }
    } catch (err) {
      console.warn(`[Proactive] voice synth/send failed contact=${contactId}, fallback to text:`, err);
    }
    return { sent: await sendQqText(contactId, text), modality: "text" };
  }

  if (modality === "sticker") {
    const sentText = await sendQqText(contactId, text);
    let stickerSent = false;
    try {
      const selection = selectSticker({ contactId, stickerIntent: PROACTIVE_STICKER_INTENT });
      if (selection.ok && (await sendQqSticker(contactId, selection.sticker)).ok) {
        markStickerSent(contactId, selection.sticker.id);
        stickerSent = true;
      }
    } catch (err) {
      console.warn(`[Proactive] sticker select/send failed contact=${contactId}:`, err);
    }
    return { sent: sentText, modality: stickerSent ? "sticker" : "text" };
  }

  return { sent: await sendQqText(contactId, text), modality: "text" };
}

/**
 * 把主动消息按目标模态（文字/语音/表情）下发到首选平台。
 * modality 由 resolveProactiveModality() 决定（PROACTIVE_MULTIMODAL_ENABLED 关闭时恒为 text）。
 * 语音/表情发送失败时自动回退纯文本，并在返回的 modality 里如实记录实际发出的模态。
 */
export async function sendProactiveMessageToPreferredPlatform(
  persona: { id: number; userId: number; name?: string },
  text: string,
  modality: ProactiveModality = "text",
): Promise<ProactiveDeliveryResult> {
  const target = await resolveProactivePreferredTarget(persona);
  if (target.platform === "qq") {
    const status = await getQqBotStatus();
    if (status.status !== "connected") {
      console.warn(`[Proactive] Persona ${persona.id} has QQ bindings but QQ is not connected`);
      return { sent: false, channel: "qq", platform: "qq", modality: "text", reason: "qq_offline" };
    }

    let sent = false;
    let actualModality: ProactiveModality = "text";
    for (const binding of target.qqBindings) {
      const result = await deliverToQqContact(binding.wechatContactId, text, modality);
      sent = result.sent || sent;
      if (result.modality !== "text") actualModality = result.modality;
    }

    return {
      sent,
      channel: "qq",
      platform: "qq",
      modality: actualModality,
      reason: sent ? undefined : "qq_send_failed",
    };
  }

  console.warn(`[Proactive] Persona ${persona.id} has no active QQ binding`);
  return { sent: false, channel: "web", platform: null, modality: "text", reason: "no_binding" };
}

// 向后兼容入口：纯文本主动消息（等价于 modality="text"）。
export async function sendProactiveTextToPreferredPlatform(
  persona: { id: number; userId: number; name?: string },
  text: string,
): Promise<ProactiveDeliveryResult> {
  return sendProactiveMessageToPreferredPlatform(persona, text, "text");
}
