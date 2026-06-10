import { searchPersonaSourceChunks, type PersonaSourceRecallChunk } from "../db";

const SOURCE_RECALL_TRIGGER =
  /记得|还记得|想起|回忆|当年|以前|那时候|那会儿|原文|原著|小说|剧情|细节|第.{0,3}次|初遇|遇见|见面|中考|考场|学校|西北|湾子|老鹰峡|柱子|王玉柱|敏子|北京|南京|姚敏|小川|老赵|小刘|大刘|小彭|林慧珍|车祸|左臂|治疗|地质|研究所|表白|亲吻|喜欢|救过|向导|睡在一起|睡一块|抱着|小时候/;

const SOURCE_FOLLOW_UP_PATTERN =
  /不对|不是这样|不是这样的|瞎说|乱说|记错|说错|再想想|好好想|具体|情形|细节|明明|根本|后来呢|然后呢|当时|哪里|哪儿|谁|怎么|为什么|为何|哪段|哪个|是不是|对不对|真的吗|之前呢|那时候呢/;

const SOURCE_CORRECTION_PATTERN =
  /不对|不是这样|不是这样的|瞎说|乱说|记错|说错|再想想|好好想|明明|根本/;

const ROUTINE_CHAT_PATTERN =
  /^(嗯|哦|好|行|可以|哈哈|嘿嘿|早|晚安|睡了|吃了吗|在吗|你在干嘛|想你|测试|1|没事)[。！？!?,，、\s]*$/;

export type SourceRecallOptions = {
  personaId: number;
  userId: number;
  messageText: string;
  recentMessages?: Array<{ role: string; content: string }>;
  limit?: number;
  maxExcerptChars?: number;
};

function hasDirectSourceTrigger(messageText: string): boolean {
  const text = messageText.trim();
  if (!text || ROUTINE_CHAT_PATTERN.test(text)) return false;
  return SOURCE_RECALL_TRIGGER.test(text);
}

function hasSourceFollowUpTrigger(messageText: string): boolean {
  const text = messageText.trim();
  if (!text || ROUTINE_CHAT_PATTERN.test(text)) return false;
  return SOURCE_FOLLOW_UP_PATTERN.test(text);
}

function recentUserSourceText(
  recentMessages: SourceRecallOptions["recentMessages"],
  currentMessageText: string,
): string {
  const current = currentMessageText.trim();
  if (!recentMessages?.length) return "";

  const sourceRelatedUserMessages = recentMessages
    .filter(message => message.role === "user")
    .map(message => message.content.trim())
    .filter(Boolean)
    .filter(content => content !== current)
    .filter(content => hasDirectSourceTrigger(content) || hasSourceFollowUpTrigger(content));

  return sourceRelatedUserMessages
    .slice(-3)
    .join("\n")
    .slice(-900);
}

export function shouldUsePersonaSourceRecall(
  messageText: string,
  recentMessages?: SourceRecallOptions["recentMessages"],
): boolean {
  if (hasDirectSourceTrigger(messageText)) return true;
  return hasSourceFollowUpTrigger(messageText) && Boolean(recentUserSourceText(recentMessages, messageText));
}

function pickExcerptStart(content: string, terms: string[], maxLength: number): number {
  if (!terms.length || Array.from(content).length <= maxLength) return 0;
  const sortedTerms = [...terms].sort((a, b) => b.length - a.length);
  let bestIndex = -1;
  for (const term of sortedTerms) {
    const index = content.indexOf(term);
    if (index >= 0 && (bestIndex < 0 || index < bestIndex)) bestIndex = index;
  }
  if (bestIndex < 0) return 0;
  return Math.max(0, bestIndex - Math.floor(maxLength / 3));
}

function cleanChunkExcerpt(content: string, terms: string[] = [], maxLength = 760): string {
  const normalized = content
    .replace(/\s+/g, " ")
    .trim();
  const chars = Array.from(normalized);
  if (chars.length <= maxLength) return normalized;

  const start = pickExcerptStart(normalized, terms, maxLength);
  const excerpt = chars.slice(start, start + maxLength).join("");
  return `${start > 0 ? "……" : ""}${excerpt}${start + maxLength < chars.length ? "……" : ""}`;
}

export function formatSourceRecallContext(
  chunks: PersonaSourceRecallChunk[],
  currentQuestion = "",
  options: { maxExcerptChars?: number } = {},
): string {
  if (chunks.length === 0) return "";
  const maxExcerptChars = options.maxExcerptChars ?? 760;

  const references = chunks.map((chunk, index) => {
    const chapter = chunk.chapterTitle?.trim() || `片段 ${chunk.chunkIndex + 1}`;
    const matched = chunk.matchedTerms?.length
      ? `；命中词：${chunk.matchedTerms.slice(0, 6).join("、")}`
      : "";
    return [
      `证据 ${index + 1}：${chunk.sourceTitle} / ${chapter} / 全书片段 ${chunk.chunkIndex + 1}${matched}`,
      `原文片段：${cleanChunkExcerpt(chunk.content, chunk.matchedTerms, maxExcerptChars)}`,
    ].join("\n");
  }).join("\n\n");

  return [
    "【原著资料库检索：内部证据】",
    currentQuestion ? `本轮用户问的是：${currentQuestion}` : "",
    "以下是当前问题命中的原著原文片段，优先级高于人物长背景和你对剧情的概括记忆。",
    "回答原著事实、地点、人物关系、先后顺序、动作细节时，只能使用这些片段里明确出现或可直接推出的信息。",
    "如果最近聊天记录里你已经说过的内容与这些原文片段冲突，要按原文修正，可以自然承认刚才记错了；不要为了维护前文错误而继续编。",
    "如果用户问“哪里、谁、什么时候、怎么发生”这类具体细节，而片段没有明确给出对应答案，不要猜一个具体名词、人物、时间或部位。",
    "只回答用户实际问到的那一点，优先 1-3 句；除非用户明确追问，不要顺着继续讲后续剧情。",
    "如果证据涉及未成年时期的身体亲近或性相关尴尬，只能含蓄概括成“要害”“私密处”“尴尬事”一类表达，不能展开露骨身体细节。",
    "不要说“资料库”“检索结果”“根据资料显示”，也不要机械复述原文；要像角色本人自然想起往事。",
    "如果片段不足以确认用户问的具体细节，就用角色口吻说记不准或只说确定的部分；绝对不要用大致剧情、常识或气氛补编细节。",
    references,
  ].filter(Boolean).join("\n");
}

export function formatSourceRecallMissContext(currentQuestion = ""): string {
  return [
    "【原著资料库检索：内部证据】",
    currentQuestion ? `本轮用户问的是：${currentQuestion}` : "",
    "当前没有命中足以回答本轮具体问题的原著原文片段。",
    "本轮仍然按原著事实问题处理：不要使用人物长背景、概括记忆、常识、气氛或上一轮错误回答来补剧情。",
    "如果用户问的是具体地点、人物、先后顺序、动作或细节，只能自然说这部分记不准，或只承认无法确认；不要编一个看似合理的答案。",
    "不要说“资料库”“检索结果”“根据资料显示”，要像角色本人自然承认记不准。",
    "回复保持短，优先 1-2 句，不要继续展开后续剧情。",
  ].filter(Boolean).join("\n");
}

function mergeRecallChunks(
  primary: PersonaSourceRecallChunk[],
  secondary: PersonaSourceRecallChunk[],
  limit: number,
): PersonaSourceRecallChunk[] {
  const merged = new Map<number, PersonaSourceRecallChunk>();
  for (const chunk of [...primary, ...secondary]) {
    const existing = merged.get(chunk.id);
    if (!existing || chunk.score > existing.score) merged.set(chunk.id, chunk);
  }
  return Array.from(merged.values()).slice(0, limit);
}

export async function buildPersonaSourceRecallContext(options: SourceRecallOptions): Promise<string> {
  if (!shouldUsePersonaSourceRecall(options.messageText, options.recentMessages)) return "";

  const limit = options.limit ?? 9;
  const direct = hasDirectSourceTrigger(options.messageText);
  const currentQuery = options.messageText.trim();
  const recentUserQuery = recentUserSourceText(options.recentMessages, options.messageText);
  const followUpWithSourceContext = Boolean(recentUserQuery)
    && (!direct || SOURCE_CORRECTION_PATTERN.test(currentQuery));

  const currentChunks = direct && !followUpWithSourceContext
    ? await searchPersonaSourceChunks(
      options.personaId,
      options.userId,
      currentQuery,
      limit,
    )
    : [];

  const shouldUseRecentFallback = followUpWithSourceContext || !direct || currentChunks.length === 0;
  const fallbackChunks = shouldUseRecentFallback && recentUserQuery
    ? await searchPersonaSourceChunks(
      options.personaId,
      options.userId,
      [recentUserQuery, currentQuery].filter(Boolean).join("\n"),
      limit,
    )
    : [];

  const chunks = mergeRecallChunks(currentChunks, fallbackChunks, limit);

  if (chunks.length === 0) return formatSourceRecallMissContext(currentQuery);

  return formatSourceRecallContext(chunks, currentQuery, {
    maxExcerptChars: options.maxExcerptChars,
  });
}
