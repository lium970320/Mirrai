import { ENV } from "../_core/env";
import { buildCurrentUserIdentityOverride } from "../_core/current-user-identity";
import {
  createMemory,
  getActiveMemoriesByPersonaId,
  getMemoryByTitleAndDate,
  getMemoryBySourceAndDate,
  getMessagesByDate,
  getReadyPersonasForDailyMemory,
  updateMemory,
} from "../db";
import type { Message, Persona } from "../../drizzle/schema";
import { llmService } from "../llm";
import {
  MEMORY_TYPE_LABELS,
  parseStructuredMemoryCardsResponse,
  structuredMemoryToInsert,
  type StructuredMemoryCard,
} from "./memory-card";
import { decideMemoryGovernance } from "./memory-governance";

type DailyMemoryParsed = {
  shouldRemember: boolean;
  title: string;
  description: string;
  importance?: number;
  keywords?: string[];
  memories?: StructuredMemoryCard[];
};

export type DailyMemoryResult =
  | { ok: true; status: "created"; personaId: number; date: string; memoryId: number; memoryIds: number[] }
  | { ok: true; status: "skipped_existing" | "skipped_no_messages" | "skipped_low_signal"; personaId: number; date: string }
  | { ok: false; status: "daily_memory_failed"; personaId: number; date: string; reason: string };

let scheduler: ReturnType<typeof setInterval> | null = null;
let running = false;
const checkedKeys = new Set<string>();

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export function localDateKey(date = new Date()): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, date.getHours(), date.getMinutes(), 0, 0);
}

function minutesSinceMidnight(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

export function dailyMemoryTitle(date: string): string {
  return `每日记忆 ${date}`;
}

export function getDailyMemoryTargetDates(now = new Date(), catchUpDays = ENV.dailyMemoryCatchUpDays): string[] {
  const hour = clampInt(ENV.dailyMemoryHour, 0, 23);
  const minute = clampInt(ENV.dailyMemoryMinute, 0, 59);
  const scheduledMinute = hour * 60 + minute;
  const startOffset = minutesSinceMidnight(now) >= scheduledMinute ? -1 : -2;
  const days = clampInt(catchUpDays, 1, 14);

  return Array.from({ length: days }, (_, index) => localDateKey(addDays(now, startOffset - index)));
}

function roleLabel(role: string, personaName: string): string {
  return role === "user" ? "用户" : personaName;
}

function timeLabel(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function formatDailyMemoryChatText(messages: Pick<Message, "role" | "content" | "createdAt">[], personaName: string, maxChars = ENV.dailyMemoryMaxChars): string {
  const full = messages
    .map(message => `${timeLabel(message.createdAt)} ${roleLabel(message.role, personaName)}：${message.content || ""}`)
    .join("\n")
    .trim();
  const limit = clampInt(maxChars, 2000, 20000);
  if (Array.from(full).length <= limit) return full;

  const chars = Array.from(full);
  const headLength = Math.floor(limit * 0.3);
  const tailLength = limit - headLength;
  return [
    chars.slice(0, headLength).join(""),
    "\n...[中间较长对话已压缩，整理记忆时重点保留开头和结尾]...\n",
    chars.slice(-tailLength).join(""),
  ].join("");
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const match = (text || "").match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function parseDailyMemoryResponse(response: string, date: string): DailyMemoryParsed {
  const explicitObject = parseJsonObject(response);
  if (explicitObject?.shouldRemember === false && !Array.isArray(explicitObject.memories)) {
    return {
      shouldRemember: false,
      title: dailyMemoryTitle(date),
      description: "",
    };
  }

  const structured = parseStructuredMemoryCardsResponse(response, {
    date,
    source: "daily_summary",
    memoryType: "daily_summary",
    category: "memory",
  }, 8);
  if (structured.length > 0) {
    const description = structured.map((memory) => {
      const typeLabel = MEMORY_TYPE_LABELS[memory.memoryType] || memory.memoryType;
      return `【${typeLabel}】${memory.title}：${memory.description}`;
    }).join("\n");
    const keywords = Array.from(new Set(structured.flatMap(memory => memory.keywords))).slice(0, 12);
    const importance = Math.max(...structured.map(memory => memory.importance));
    return {
      shouldRemember: true,
      title: structured[0].title,
      description,
      importance,
      keywords,
      memories: structured,
    };
  }

  const parsed = explicitObject;
  if (!parsed) {
    return {
      shouldRemember: false,
      title: dailyMemoryTitle(date),
      description: "",
    };
  }

  const shouldRemember = parsed.shouldRemember !== false;
  const title = typeof parsed.title === "string" && parsed.title.trim()
    ? parsed.title.trim().slice(0, 160)
    : dailyMemoryTitle(date);
  const description = typeof parsed.description === "string" ? parsed.description.trim().slice(0, 1800) : "";
  const importance = typeof parsed.importance === "number" ? parsed.importance : undefined;
  const keywords = Array.isArray(parsed.keywords)
    ? parsed.keywords.map(item => typeof item === "string" ? item.trim() : "").filter(Boolean).slice(0, 12)
    : undefined;

  return {
    shouldRemember: shouldRemember && Boolean(description),
    title,
    description,
    importance,
    keywords,
  };
}

function buildDailyMemoryPrompt(persona: Persona, date: string, chatText: string): string {
  return [
    `请整理 ${date} 用户和 ${persona.name} 的聊天，提取“以后角色应该记住”的长期关系记忆卡片。`,
    "这不是日记，不要写抒情流水账；只保留会影响未来对话的事实、偏好、承诺、关系进展、未解决问题、冲突修复、重要情绪节点。",
    "普通寒暄、重复催睡、无信息量的闲聊不要写成长期记忆。",
    "不要把你从语气里猜出来但聊天里没有明确证据的内容写成事实；不确定就降低 confidence。",
    buildCurrentUserIdentityOverride("每日记忆用户身份覆盖"),
    "写记忆卡片时，如果需要第三人称描述敏子/用户，必须写“他”；不要把敏子/用户写成“她”。",
    "如果当天没有值得长期记住的信息，返回 {\"memories\":[]}。",
    "只返回 JSON 对象，不要 Markdown。memoryType 只能使用：user_fact, relationship_event, promise, preference, emotional_moment, conflict, open_loop。",
    "importance 是重要程度 1-5，confidence 是可信程度 1-5。keywords 写 3-8 个后续可召回的中文关键词。",
    '{"memories":[{"title":"不超过40字","description":"80-300字，具体写清这条长期记忆","memoryType":"relationship_event","category":"memory","importance":4,"confidence":4,"keywords":["关键词"],"emotion":"温柔/委屈/开心/低落/克制"}]}',
    "",
    "聊天记录：",
    chatText,
  ].join("\n");
}

export async function extractDailyMemoryForPersona(persona: Persona, date: string): Promise<DailyMemoryResult> {
  const personaId = persona.id;
  const userId = persona.userId;
  const title = dailyMemoryTitle(date);

  try {
    const existing = await getMemoryByTitleAndDate(personaId, userId, title, date)
      || await getMemoryBySourceAndDate(personaId, userId, "daily_summary", date);
    if (existing) return { ok: true, status: "skipped_existing", personaId, date };

    const messages = await getMessagesByDate(personaId, userId, date);
    if (messages.length === 0) return { ok: true, status: "skipped_no_messages", personaId, date };
    if (messages.length < clampInt(ENV.dailyMemoryMinMessages, 1, 50)) {
      return { ok: true, status: "skipped_low_signal", personaId, date };
    }

    const chatText = formatDailyMemoryChatText(messages, persona.name);
    if (!chatText) return { ok: true, status: "skipped_no_messages", personaId, date };

    console.info(`[DailyMemory] memory_extract_start persona=${personaId} date=${date} messages=${messages.length}`);
    const response = await llmService.invoke({
      messages: [
        {
          role: "system",
          content: [
            "你是长期记忆整理助手。你只提取未来对话真正需要记住的信息，避免把普通闲聊写进长期记忆。",
            buildCurrentUserIdentityOverride("每日记忆用户身份覆盖"),
          ].join("\n\n"),
        },
        { role: "user", content: buildDailyMemoryPrompt(persona, date, chatText) },
      ],
      options: {
        provider: (persona as any).llmProvider || undefined,
        purpose: "memory_extract",
        userId,
        personaId,
        route: "memory.daily_summary",
        temperature: 0.2,
        maxTokens: 700,
      },
    });

    const parsed = parseDailyMemoryResponse(response, date);
    if (!parsed.shouldRemember || (parsed.importance ?? 3) <= 1) {
      console.info(`[DailyMemory] memory_extract_skipped_low_signal persona=${personaId} date=${date}`);
      return { ok: true, status: "skipped_low_signal", personaId, date };
    }

    const evidenceMessageIds = messages.map(message => message.id).slice(-80);
    const cards = parsed.memories?.length
      ? parsed.memories
      : parseStructuredMemoryCardsResponse(JSON.stringify({
        title: parsed.title,
        description: parsed.description,
        importance: parsed.importance,
        keywords: parsed.keywords,
      }), {
        date,
        source: "daily_summary",
        memoryType: "daily_summary",
        category: "memory",
        evidenceMessageIds,
      }, 1);
    // 每日记忆写入必须和回合内 consolidation 走同一套治理：去重 / 冲突 / 关闭话题，
    // 否则每日整理产出的卡片会与当天实时沉淀的卡片重复、或与历史事实冲突却得不到标记，
    // 长期累积近义重复会稀释 top-N 召回质量。
    const existingMemories = await getActiveMemoriesByPersonaId(personaId, userId);
    const memoryIds: number[] = [];
    for (const card of cards) {
      const cardForGovernance: StructuredMemoryCard = {
        ...card,
        source: "daily_summary",
        date,
        evidenceMessageIds: card.evidenceMessageIds.length > 0 ? card.evidenceMessageIds : evidenceMessageIds,
      };
      const decision = decideMemoryGovernance(cardForGovernance, existingMemories as any);
      if (decision.action === "skip_duplicate") {
        console.info(`[DailyMemory] memory_skip_duplicate persona=${personaId} date=${date} duplicateOf=${decision.duplicateOf}`);
        continue;
      }
      for (const id of decision.archiveIds) {
        await updateMemory(id, userId, { status: "archived" });
      }
      for (const id of decision.contradictIds) {
        await updateMemory(id, userId, { status: "contradicted", confidence: 1 });
      }
      const memoryId = await createMemory(structuredMemoryToInsert(cardForGovernance, personaId, userId));
      memoryIds.push(memoryId);
    }
    if (memoryIds.length === 0) return { ok: true, status: "skipped_low_signal", personaId, date };

    console.info(`[DailyMemory] memory_extract_success persona=${personaId} date=${date} memoryIds=${memoryIds.join(",")}`);
    return { ok: true, status: "created", personaId, date, memoryId: memoryIds[0], memoryIds };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[DailyMemory] memory_extract_failed persona=${personaId} date=${date}: ${reason}`);
    return { ok: false, status: "daily_memory_failed", personaId, date, reason };
  }
}

export async function runDailyMemoryTick(now = new Date()): Promise<DailyMemoryResult[]> {
  if (!ENV.dailyMemoryEnabled) return [];
  if (running) return [];
  running = true;

  try {
    const personas = await getReadyPersonasForDailyMemory();
    const dates = getDailyMemoryTargetDates(now);
    const results: DailyMemoryResult[] = [];

    for (const persona of personas) {
      for (const date of dates) {
        const key = `${persona.id}:${date}`;
        if (checkedKeys.has(key)) continue;
        checkedKeys.add(key);
        results.push(await extractDailyMemoryForPersona(persona, date));
      }
    }

    if (checkedKeys.size > 5000) checkedKeys.clear();
    return results;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[DailyMemory] Scheduler tick failed: ${reason}`);
    return [];
  } finally {
    running = false;
  }
}

export function startDailyMemoryScheduler() {
  if (!ENV.dailyMemoryEnabled) {
    console.log("[DailyMemory] Scheduler disabled");
    return;
  }
  if (scheduler) return;

  const intervalMinutes = clampInt(ENV.dailyMemoryIntervalMinutes, 1, 1440);
  scheduler = setInterval(() => void runDailyMemoryTick(), intervalMinutes * 60_000);
  void runDailyMemoryTick();
  console.log(`[DailyMemory] Scheduler started (${String(clampInt(ENV.dailyMemoryHour, 0, 23)).padStart(2, "0")}:${String(clampInt(ENV.dailyMemoryMinute, 0, 59)).padStart(2, "0")} local, catch-up ${clampInt(ENV.dailyMemoryCatchUpDays, 1, 14)}d)`);
}

export function stopDailyMemoryScheduler() {
  if (!scheduler) return;
  clearInterval(scheduler);
  scheduler = null;
}
