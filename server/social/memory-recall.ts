import { getActiveMemoriesByPersonaId, touchMemoriesByIds } from "../db";
import { buildCurrentUserIdentityOverride } from "../_core/current-user-identity";
import type { PersonaMemoryMode, PersonaTurnIntent } from "./persona-turn-planner";
import {
  MEMORY_SOURCE_LABELS,
  MEMORY_TYPE_LABELS,
  type MemorySource,
  type MemoryType,
} from "./memory-card";
import type { PersonaReflection } from "./persona-reflection";

type RecentMessage = {
  role: string;
  content: string;
};

type MemoryRecord = {
  id: number;
  title: string;
  description: string | null;
  category: string;
  date: string | null;
  source?: string;
  memoryType?: string;
  importance?: number;
  confidence?: number;
  keywords?: unknown;
  emotion?: string | null;
  status?: string;
  followUpAt?: Date | string | null;
  lastAccessedAt?: Date | string | null;
  createdAt: Date;
};

export type PersonaMemoryRecallOptions = {
  personaId: number;
  userId: number;
  messageText: string;
  recentMessages?: RecentMessage[];
  memoryMode?: PersonaMemoryMode;
  turnIntent?: PersonaTurnIntent;
  reflection?: PersonaReflection;
  limit?: number;
  maxDescriptionChars?: number;
};

const MEMORY_TRIGGER_PATTERN =
  /记得|记不记得|想起|回忆|之前|以前|上次|刚才|昨天|前天|那天|我说过|你说过|答应|约定|承诺|喜欢|讨厌|习惯|生日|纪念|重要|关系|异地|武汉|南京|上课|工作|课程|爱我|爱你|想我|想你|表白|心里话|内心/;

const STOP_WORDS = new Set([
  "这个", "那个", "什么", "怎么", "为什么", "是不是", "没有", "就是", "然后",
  "还是", "可以", "现在", "一下", "一个", "一些", "我们", "你们", "他们",
  "今天", "昨天", "之前", "以前", "刚才", "真的", "感觉", "时候",
]);

function compact(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (Array.from(normalized).length <= maxLength) return normalized;
  return `${Array.from(normalized).slice(0, maxLength).join("")}...`;
}

function applyCurrentUserPronounOverride(text: string): string {
  return text
    .replace(/敏子([^。！？!?；;\n]{0,24})她/g, "敏子$1他")
    .replace(/用户([^。！？!?；;\n]{0,24})她/g, "用户$1他")
    .replace(/她([^。！？!?；;\n]{0,24})敏子/g, "他$1敏子")
    .replace(/她([^。！？!?；;\n]{0,24})用户/g, "他$1用户")
    .replace(/记住她/g, "记住他")
    .replace(/回应她/g, "回应他")
    .replace(/接住她/g, "接住他")
    .replace(/她的话/g, "他的话")
    .replace(/她白天/g, "他白天")
    .replace(/她在武汉/g, "他在武汉")
    .replace(/她已经/g, "他已经");
}

function termsFrom(text: string): string[] {
  const chineseTerms = Array.from(text.matchAll(/[\u4e00-\u9fa5]{2,8}/g))
    .map(match => match[0])
    .filter(term => !STOP_WORDS.has(term));
  const latinTerms = Array.from(text.matchAll(/[a-zA-Z0-9_]{3,}/g)).map(match => match[0].toLowerCase());
  return Array.from(new Set([...chineseTerms, ...latinTerms])).slice(0, 24);
}

function shouldUseMemoryRecall(options: PersonaMemoryRecallOptions): boolean {
  const text = options.messageText.trim();
  if (!text) return false;
  if (options.reflection?.shouldRecallMemory) return true;
  if (MEMORY_TRIGGER_PATTERN.test(text)) return true;
  return options.memoryMode === "relationship_ledger";
}

function keywordText(value: unknown): string {
  return Array.isArray(value)
    ? value.filter(item => typeof item === "string").join("\n")
    : "";
}

function memoryTypeOf(memory: MemoryRecord): MemoryType {
  return (memory.memoryType || "relationship_event") as MemoryType;
}

function memorySourceOf(memory: MemoryRecord): MemorySource {
  return (memory.source || "manual") as MemorySource;
}

function preferredTypesFor(options: PersonaMemoryRecallOptions): Set<MemoryType> {
  const preferred = new Set<MemoryType>();
  const intent = options.reflection?.intent ?? options.turnIntent;
  const mode = options.memoryMode;

  if (mode === "relationship_ledger" || intent === "affection_expression" || intent === "emotional_support") {
    preferred.add("relationship_event");
    preferred.add("promise");
    preferred.add("emotional_moment");
    preferred.add("conflict");
    preferred.add("open_loop");
  }
  if (intent === "daily_chat" || mode === "recent_context") {
    preferred.add("preference");
    preferred.add("user_fact");
    preferred.add("relationship_event");
    preferred.add("open_loop");
  }
  if (intent === "correction") {
    preferred.add("open_loop");
    preferred.add("conflict");
    preferred.add("promise");
    preferred.add("source_fact");
  }
  if (mode === "source_library" || intent === "source_recall") {
    preferred.add("persona_background");
    preferred.add("source_fact");
    preferred.add("relationship_event");
  }

  return preferred;
}

/** 显著性：重要记忆和近期访问过的记忆更易被想起；很旧、低重要度、长期没碰的自然淡出（仅影响排名，不归档/删除）。 */
function salienceAdjustment(memory: MemoryRecord): number {
  const recencyRef = memory.lastAccessedAt
    ? new Date(memory.lastAccessedAt).getTime()
    : memory.createdAt.getTime();
  if (!Number.isFinite(recencyRef)) return 0;
  const ageDays = (Date.now() - recencyRef) / 86_400_000;
  let adjust = 0;
  if (ageDays <= 7) adjust += 1;
  if ((memory.importance ?? 3) <= 2 && ageDays > 30) adjust -= 3;
  return adjust;
}

export function scoreMemory(memory: MemoryRecord, terms: string[], options: PersonaMemoryRecallOptions): number {
  if (memory.status && memory.status !== "active") return -999;
  const haystack = [
    memory.title,
    memory.description || "",
    memory.date || "",
    memoryTypeOf(memory),
    memorySourceOf(memory),
    keywordText(memory.keywords),
    memory.emotion || "",
  ].join("\n").toLowerCase();
  let score = 0;

  for (const term of terms) {
    if (haystack.includes(term.toLowerCase())) score += Math.min(8, term.length);
  }

  if (memory.category === "milestone") score += 4;
  if (memory.category === "anniversary") score += 3;
  if (options.memoryMode === "relationship_ledger" && /爱|想|关系|异地|武汉|南京|承诺|在乎|表白|亲近/.test(haystack)) {
    score += 5;
  }
  if (preferredTypesFor(options).has(memoryTypeOf(memory))) score += 5;
  score += Math.max(0, Math.min(5, memory.importance ?? 3));
  score += Math.max(0, Math.min(5, memory.confidence ?? 3)) - 2;
  if ((memory.confidence ?? 3) <= 2) score -= 2;
  if (memorySourceOf(memory) === "source_material" && options.memoryMode !== "source_library") score -= 3;
  if (memoryTypeOf(memory) === "source_fact" && options.memoryMode !== "source_library") score -= 2;

  // 未完成话题（尤其已到回访时间的）更值得被想起，方便自然问起"上次那件事"。
  if (memoryTypeOf(memory) === "open_loop") {
    score += 1;
    const followUp = memory.followUpAt ? new Date(memory.followUpAt).getTime() : NaN;
    if (Number.isFinite(followUp) && followUp <= Date.now()) score += 5;
  }

  score += salienceAdjustment(memory);

  return score;
}

export function formatMemoryRecallContext(memories: MemoryRecord[], options: { maxDescriptionChars?: number } = {}): string {
  if (memories.length === 0) return "";
  const maxDescriptionChars = options.maxDescriptionChars ?? 220;

  const lines = memories.map((memory, index) => {
    const date = memory.date ? ` / ${memory.date}` : "";
    const typeLabel = MEMORY_TYPE_LABELS[memoryTypeOf(memory)] || memory.memoryType || "记忆";
    const sourceLabel = MEMORY_SOURCE_LABELS[memorySourceOf(memory)] || memory.source || "未知来源";
    const confidence = memory.confidence ? ` / 可信度${memory.confidence}` : "";
    const importance = memory.importance ? ` / 重要度${memory.importance}` : "";
    const title = applyCurrentUserPronounOverride(memory.title);
    const description = memory.description
      ? `：${applyCurrentUserPronounOverride(compact(memory.description, maxDescriptionChars))}`
      : "";
    return `${index + 1}. [${typeLabel} / ${sourceLabel}${importance}${confidence}] ${title}${date}${description}`;
  });

  return [
    "【长期关系记忆】",
    buildCurrentUserIdentityOverride("长期记忆用户身份覆盖"),
    "以下是从过往聊天、每日整理或手动添加中筛出的少量长期记忆，只在与本轮有关时自然使用。",
    "它们的优先级高于临时发挥；不要机械复述“我记得第几条”，不要把没有写明的细节补编出来。",
    "如果来源是原著资料或可信度较低，只能作为设定/线索，不能直接当成你和用户共同经历。",
    ...lines,
  ].join("\n");
}

export async function buildPersonaMemoryRecallContext(options: PersonaMemoryRecallOptions): Promise<string> {
  if (!shouldUseMemoryRecall(options)) return "";

  const recentUserText = (options.recentMessages || [])
    .filter(message => message.role === "user")
    .slice(-4)
    .map(message => message.content)
    .join("\n");
  const reflectionTerms = options.reflection?.memoryQueries?.join("\n") || "";
  const terms = termsFrom(`${recentUserText}\n${options.messageText}\n${reflectionTerms}`);
  const memories = await getActiveMemoriesByPersonaId(options.personaId, options.userId) as MemoryRecord[];
  if (memories.length === 0) return "";

  const scored = memories
    .map(memory => ({ memory, score: scoreMemory(memory, terms, options) }))
    .filter(item => item.score > 0 || options.memoryMode === "relationship_ledger" || options.reflection?.shouldRecallMemory)
    .sort((a, b) => b.score - a.score || b.memory.createdAt.getTime() - a.memory.createdAt.getTime())
    .slice(0, options.limit ?? 4)
    .map(item => item.memory);

  await touchMemoriesByIds(scored.map(memory => memory.id), options.userId);
  return formatMemoryRecallContext(scored, { maxDescriptionChars: options.maxDescriptionChars });
}
