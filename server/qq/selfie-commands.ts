/**
 * 「让人物发自拍」的指令解析。只负责识别用户是否明确要自拍 + 提取情境，
 * 不再做固定 ACK / 立即触发——是否发、怎么自然回应，交给 social/selfie-decision +
 * message-handler 的决策与异步发图链路统一处理。
 */

export type SelfieCommand = { situation: string; withPartner?: boolean };

// 识别「让人物发自拍/拍照」的意图：索取动词（发/来/拍/给我/想看/要）+ 照片名词（自拍/照片/相片/靓照），
// 或「拍(一/张/个)照」固定搭配，或单独「自拍」。比旧版宽松，覆盖"发个自拍""给我拍张照片""能拍张照吗"等
// 自然口语；仍要求"动词 + 照片名词"成对，避免误吃"照顾好自己""我想看看你""来个拥抱"。
const SELFIE_INTENT_RE =
  /(?:发|来|拍|给我|想看看?你?|要)[^。！？!?\n]{0,4}(?:自拍|照片|相片|靓照)|拍[一个张]{0,2}照|合拍|合照|一起拍|自拍/;

// 情境：照片名词之后跟分隔符（：，或空格）的描述，如"发张自拍 在公园"→"在公园"。
const SELFIE_SITUATION_PUNCT_RE = /(?:自拍|照片|相片|靓照|照)\s*[:：，,]\s*(.+)$/;
const SELFIE_SITUATION_SPACE_RE = /(?:自拍|照片|相片|靓照|照)\s+(.+)$/;

// 合拍/合照/一起拍 → 想要两人合照（而非单人自拍）。
const PARTNER_RE = /合拍|合照|一起拍|和你拍|跟你拍|和我拍/;

export function parseSelfieCommand(text: string): SelfieCommand | null {
  const t = text.trim().replace(/^\/+/, "").trim();
  if (!t) return null;
  if (!SELFIE_INTENT_RE.test(t)) return null;
  const m = t.match(SELFIE_SITUATION_PUNCT_RE) ?? t.match(SELFIE_SITUATION_SPACE_RE);
  const situation = (m?.[1] ?? "").trim();
  // withPartner 仅在合拍时出现，普通自拍不带这字段（保持返回结构干净）。
  return PARTNER_RE.test(t) ? { situation, withPartner: true } : { situation };
}
