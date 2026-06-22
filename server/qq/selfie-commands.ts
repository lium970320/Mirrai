import { ENV } from "../_core/env";
import { generatePersonaSelfie } from "../image/selfie-provider";
import { sendQqImageFile, sendQqText } from "./onebot-client";

/**
 * QQ 私聊里的「让人物发自拍」指令——用户说「发张自拍 / 拍张照 [情境]」时，
 * 人物先回一句「等下拍给你」，随后在后台异步生成并把图片发回来（生成要几十秒到几分钟）。
 *
 * 命令解析锚定开头、比较克制，避免误吃正常聊天。开关关闭（默认）时直接返回 null，
 * 指令不被识别、当普通聊天处理，因此合入代码不改变现状。
 */

export type SelfieCommand = { situation: string };

const SELFIE_RE =
  /^(?:你)?(?:(?:发|来|给我(?:来)?|拍)(?:一)?张?(?:自拍|照片?|照)|自拍)\s*[:：，,]?\s*(.*)$/;

export function parseSelfieCommand(text: string): SelfieCommand | null {
  const t = text.trim().replace(/^\/+/, "").trim();
  if (!t) return null;
  const m = t.match(SELFIE_RE);
  if (!m) return null;
  return { situation: (m[1] ?? "").trim() };
}

const ACK_TEXTS = [
  "等我一下，拍张给你～📷",
  "行，我拍张给你，稍等一下下。",
  "好，等会儿，给你拍一张。",
];

function pickAck(situation: string): string {
  // 用情境长度做一个稳定的小变化，避免引入随机源。
  const base = ACK_TEXTS[situation.length % ACK_TEXTS.length] ?? ACK_TEXTS[0];
  return base;
}

async function generateAndSend(contactId: string, situation: string): Promise<void> {
  try {
    const result = await generatePersonaSelfie(situation);
    if (!result) {
      await sendQqText(contactId, "诶，刚拍的没拍好，等会儿再给你补一张。");
      return;
    }
    const ok = await sendQqImageFile(contactId, result.imagePath);
    if (!ok) {
      await sendQqText(contactId, "照片拍好了，但发的时候出了点问题，等下再发你。");
    }
  } catch (err) {
    console.warn(`[QQ] selfie generate/send failed contact=${contactId}:`, err);
    await sendQqText(contactId, "拍照的时候出了点小状况，等下再说哈。");
  }
}

/**
 * 命中自拍指令则启动异步生成（不阻塞当前消息处理），返回要立即回给用户的「等下拍给你」文本；
 * 不是自拍指令或功能未开启则返回 null（交给正常聊天）。
 */
export function tryHandleSelfieCommand(contactId: string, text: string): string | null {
  if (!ENV.personaSelfieEnabled) return null;
  const command = parseSelfieCommand(text);
  if (!command) return null;
  void generateAndSend(contactId, command.situation);
  return pickAck(command.situation);
}
