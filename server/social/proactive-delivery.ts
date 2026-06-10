import {
  getActiveQqBindingsByPersonaId,
  getActiveWechatBindingsByPersonaId,
} from "../db";
import { getQqBotStatus, sendQqText } from "../qq/onebot-client";
import { getBotStatus, sendWeChatText } from "../wechat/bot";
import type { SocialRuntimeChannel, SocialRuntimePlatform } from "./runtime-request";

export type ProactivePreferredTarget = {
  channel: SocialRuntimeChannel;
  platform: Exclude<SocialRuntimePlatform, "web"> | null;
  qqBindings: Array<{ wechatContactId: string }>;
  wechatBindings: Array<{ wechatContactId: string; wechatName?: string | null }>;
};

export type ProactiveDeliveryResult = {
  sent: boolean;
  channel: SocialRuntimeChannel;
  platform: "qq" | "wechat" | null;
  reason?: string;
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
      wechatBindings: [],
    };
  }

  const wechatBindings = await getActiveWechatBindingsByPersonaId(persona.id, persona.userId);
  return {
    channel: wechatBindings.length > 0 ? "wechat" : "web",
    platform: wechatBindings.length > 0 ? "wechat" : null,
    qqBindings: [],
    wechatBindings,
  };
}

export async function sendProactiveTextToPreferredPlatform(
  persona: { id: number; userId: number; name?: string },
  text: string,
): Promise<ProactiveDeliveryResult> {
  const target = await resolveProactivePreferredTarget(persona);
  if (target.platform === "qq") {
    const status = await getQqBotStatus();
    if (status.status !== "connected") {
      console.warn(`[Proactive] Persona ${persona.id} has QQ bindings but QQ is not connected`);
      return { sent: false, channel: "qq", platform: "qq", reason: "qq_offline" };
    }

    let sent = false;
    for (const binding of target.qqBindings) {
      sent = (await sendQqText(binding.wechatContactId, text)) || sent;
    }

    return {
      sent,
      channel: "qq",
      platform: "qq",
      reason: sent ? undefined : "qq_send_failed",
    };
  }

  if (target.platform !== "wechat") {
    console.warn(`[Proactive] Persona ${persona.id} has no active QQ or WeChat binding`);
    return { sent: false, channel: "web", platform: null, reason: "no_binding" };
  }

  if (getBotStatus().status !== "logged_in") {
    return { sent: false, channel: "wechat", platform: "wechat", reason: "wechat_offline" };
  }

  let sent = false;
  for (const binding of target.wechatBindings) {
    sent = (await sendWeChatText(binding.wechatContactId, text, binding.wechatName)) || sent;
  }

  return {
    sent,
    channel: "wechat",
    platform: "wechat",
    reason: sent ? undefined : "wechat_send_failed",
  };
}
