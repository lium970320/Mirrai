/**
 * 「让人物发自拍」的指令解析。只负责识别用户是否明确要自拍 + 提取情境，
 * 不再做固定 ACK / 立即触发——是否发、怎么自然回应，交给 social/selfie-decision +
 * message-handler 的决策与异步发图链路统一处理。
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
