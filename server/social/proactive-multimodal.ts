import { ENV } from "../_core/env";

/**
 * 主动消息多模态：真人偶尔会主动发条语音/表情，而不只是文字。
 * 由 PROACTIVE_MULTIMODAL_ENABLED 控制，默认关闭。
 * 本模块只提供"该用哪种模态"的决策原语；实际语音/表情发送的集成是后续工作。
 */

export type ProactiveModality = "text" | "voice" | "sticker";

// 低概率：绝大多数主动消息仍是文字，偶尔语音/表情。
const VOICE_PROBABILITY = 0.12;
const STICKER_PROBABILITY = 0.1;

export function isProactiveMultimodalEnabled(): boolean {
  return ENV.proactiveMultimodalEnabled;
}

/** 纯函数：决定本条主动消息走哪种模态（不读开关）。 */
export function decideProactiveModality(random: () => number = Math.random): ProactiveModality {
  const roll = random();
  if (roll < VOICE_PROBABILITY) return "voice";
  if (roll < VOICE_PROBABILITY + STICKER_PROBABILITY) return "sticker";
  return "text";
}

/** 开关开启时给出本条主动消息的目标模态；关闭时恒为 text。 */
export function resolveProactiveModality(random: () => number = Math.random): ProactiveModality {
  if (!isProactiveMultimodalEnabled()) return "text";
  return decideProactiveModality(random);
}
