import {
  getActiveQqBindingsByPersonaId,
  getActiveWechatBindingsByPersonaId,
} from "../db";
import { getQqBotStatus, sendQqText } from "../qq/onebot-client";
import { getBotStatus, sendWeChatText } from "../wechat/bot";

export type ProactiveDeliveryResult = {
  sent: boolean;
  channel: "web" | "wechat";
  platform: "qq" | "wechat" | null;
  reason?: string;
};

export async function sendProactiveTextToPreferredPlatform(
  persona: { id: number; userId: number; name?: string },
  text: string,
): Promise<ProactiveDeliveryResult> {
  const qqBindings = await getActiveQqBindingsByPersonaId(persona.id, persona.userId);
  if (qqBindings.length > 0) {
    const status = await getQqBotStatus();
    if (status.status !== "connected") {
      console.warn(`[Proactive] Persona ${persona.id} has QQ bindings but QQ is not connected`);
      return { sent: false, channel: "web", platform: "qq", reason: "qq_offline" };
    }

    let sent = false;
    for (const binding of qqBindings) {
      sent = (await sendQqText(binding.wechatContactId, text)) || sent;
    }

    return {
      sent,
      channel: "web",
      platform: "qq",
      reason: sent ? undefined : "qq_send_failed",
    };
  }

  const wechatBindings = await getActiveWechatBindingsByPersonaId(persona.id, persona.userId);
  if (wechatBindings.length === 0) {
    console.warn(`[Proactive] Persona ${persona.id} has no active QQ or WeChat binding`);
    return { sent: false, channel: "web", platform: null, reason: "no_binding" };
  }

  if (getBotStatus().status !== "logged_in") {
    return { sent: false, channel: "wechat", platform: "wechat", reason: "wechat_offline" };
  }

  let sent = false;
  for (const binding of wechatBindings) {
    sent = (await sendWeChatText(binding.wechatContactId, text, binding.wechatName)) || sent;
  }

  return {
    sent,
    channel: "wechat",
    platform: "wechat",
    reason: sent ? undefined : "wechat_send_failed",
  };
}
