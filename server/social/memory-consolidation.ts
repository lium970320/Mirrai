import type { Message, Persona } from "../../drizzle/schema";
import { buildCurrentUserIdentityOverride } from "../_core/current-user-identity";
import * as db from "../db";
import { llmService } from "../llm";
import {
  parseStructuredMemoryCardsResponse,
  structuredMemoryToInsert,
  type StructuredMemoryCard,
} from "./memory-card";
import { decideMemoryGovernance, type MemoryGovernanceDecision } from "./memory-governance";
import type { PersonaReflection } from "./persona-reflection";
import type { PersonaTurnPlan } from "./persona-turn-planner";

export type MemoryConsolidationInput = {
  persona: Persona;
  userId: number;
  userMessageId: number;
  assistantMessageId: number;
  userText: string;
  assistantText: string;
  recentMessages: Array<Pick<Message, "role" | "content" | "createdAt">>;
  reflection: PersonaReflection;
  turnPlan: PersonaTurnPlan;
  memoryRecallUsed: boolean;
  sourceRecallUsed: boolean;
};

export type MemoryConsolidationResult = {
  status:
    | "created"
    | "skipped_low_signal"
    | "skipped_duplicate"
    | "skipped_source_guard"
    | "skipped_no_cards"
    | "failed";
  reason: string;
  attempted: boolean;
  createdMemoryIds: number[];
  skippedDuplicateIds: number[];
  archivedMemoryIds: number[];
  contradictedMemoryIds: number[];
  cards: Array<Pick<StructuredMemoryCard, "title" | "memoryType" | "importance" | "confidence" | "keywords">>;
  decisions: MemoryGovernanceDecision[];
};

const IMPORTANT_TYPES = new Set([
  "preference",
  "promise",
  "conflict",
  "open_loop",
  "emotional_moment",
  "relationship_event",
  "user_fact",
]);

function compact(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (Array.from(normalized).length <= maxLength) return normalized;
  return `${Array.from(normalized).slice(0, maxLength).join("")}...`;
}

function localDateKey(date = new Date()): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function interestingSignal(text: string): boolean {
  return /记住|别忘|以后|以后不要|下次|承诺|答应|约定|喜欢|不喜欢|讨厌|习惯|生日|纪念|重要|关系|异地|武汉|南京|上课|工作|课程|冷漠|敷衍|生气|委屈|和好|表白|爱我|想我|想你|内心/.test(text);
}

function tooShortForMemory(text: string): boolean {
  const compacted = text.replace(/\s+/g, "");
  return compacted.length <= 4 && /^(嗯|哦|好|行|可以|没|没有|1|测试|收到|在)$/.test(compacted);
}

export function shouldAttemptMemoryConsolidation(input: Pick<MemoryConsolidationInput,
  "userText" | "assistantText" | "reflection" | "turnPlan" | "sourceRecallUsed"
>): { attempt: boolean; reason: string } {
  const combined = `${input.userText}\n${input.assistantText}`;
  if (tooShortForMemory(input.userText)) {
    return { attempt: false, reason: "用户消息过短且没有长期记忆信号。" };
  }
  if (input.sourceRecallUsed && input.turnPlan.intent !== "correction") {
    return { attempt: false, reason: "本轮主要依赖原著/资料召回，避免把资料内容误写为共同经历。" };
  }
  if (input.reflection.shouldRecordMemory) {
    return { attempt: true, reason: input.reflection.recordReason || "隐藏思考层判断本轮可能值得记住。" };
  }
  if (
    ["affection_expression", "emotional_support", "correction"].includes(input.turnPlan.intent)
    && interestingSignal(combined)
  ) {
    return { attempt: true, reason: "本轮是关系/情绪/纠错场景，并包含明确长期记忆信号。" };
  }
  if (interestingSignal(input.userText) && Array.from(input.userText).length >= 12) {
    return { attempt: true, reason: "用户消息包含偏好、承诺、地点、关系或未完成事项信号。" };
  }
  return { attempt: false, reason: "本轮信号不足，跳过自动沉淀。" };
}

function formatRecentMessages(messages: MemoryConsolidationInput["recentMessages"]): string {
  return messages.slice(-8).map((message) => {
    const role = message.role === "user" ? "用户" : "角色";
    return `${role}：${compact(message.content, 180)}`;
  }).join("\n");
}

function buildConsolidationPrompt(input: MemoryConsolidationInput): string {
  return [
    "请判断这一轮聊天是否应该沉淀为长期记忆卡片。",
    "只记录以后会影响角色回复的事实、偏好、承诺、关系进展、冲突修复、未完成话题或重要情绪节点。",
    "普通寒暄、测试消息、重复关心、模型自己的临时发挥不要写入。",
    "不要把原著资料、角色猜测、玩笑、没有证据的心理推断写成共同经历。",
    buildCurrentUserIdentityOverride("长期记忆用户身份覆盖"),
    "写记忆卡片时，如果需要第三人称描述敏子/用户，必须写“他”；不要把敏子/用户写成“她”。",
    "如果没有值得记住的内容，返回 {\"memories\":[]}。",
    "只返回 JSON 对象。最多 2 条。importance 和 confidence 都是 1-5；只有重要且可信的内容才给 4 或 5。",
    "memoryType 只能使用：user_fact, relationship_event, promise, preference, emotional_moment, conflict, open_loop。",
    "",
    `角色：${input.persona.name}`,
    `本轮 intent：${input.reflection.intent || input.turnPlan.intent}`,
    `隐藏思考 recordReason：${input.reflection.recordReason || "无"}`,
    `隐藏思考 innerReaction：${input.reflection.innerReaction || "无"}`,
    "",
    "最近上下文：",
    formatRecentMessages(input.recentMessages) || "无",
    "",
    "本轮用户消息：",
    input.userText,
    "",
    "本轮角色回复：",
    input.assistantText,
    "",
    'JSON 模板：{"memories":[{"title":"不超过40字","description":"80-260字，写清楚具体事实和证据边界","memoryType":"preference","category":"memory","importance":4,"confidence":4,"keywords":["关键词"],"emotion":"心情词"}]}',
  ].join("\n");
}

function defaultResult(status: MemoryConsolidationResult["status"], reason: string, attempted: boolean): MemoryConsolidationResult {
  return {
    status,
    reason,
    attempted,
    createdMemoryIds: [],
    skippedDuplicateIds: [],
    archivedMemoryIds: [],
    contradictedMemoryIds: [],
    cards: [],
    decisions: [],
  };
}

function isConservativeCard(card: StructuredMemoryCard): boolean {
  if (card.confidence < 3) return false;
  if (!IMPORTANT_TYPES.has(card.memoryType)) return false;
  if (card.importance >= 4) return true;
  return ["promise", "preference", "conflict", "open_loop"].includes(card.memoryType) && card.importance >= 3;
}

const FOLLOW_UP_DAY_PATTERNS: Array<{ re: RegExp; days: number }> = [
  { re: /大后天|大後天/, days: 3 },
  { re: /后天|後天/, days: 2 },
  { re: /明天|明日|明早|明晚/, days: 1 },
  { re: /下周|下週|下星期|下礼拜|下禮拜/, days: 7 },
];

// 事件类未完成事项（无明确日期）默认次日轻轻问起，兑现「你昨天说的X怎么样了」。
const FOLLOW_UP_EVENT_RE =
  /面试|面試|考试|考試|考完|笔试|筆試|复试|複試|出分|看病|就诊|就診|复诊|複診|复查|複查|体检|體檢|手术|手術|答辩|答辯|开庭|開庭|汇报|匯報|交付|截止/;

// 事件已取消 / 黄了 / 不再发生时不埋回访，避免次日尴尬追问「上次那件事怎么样了」。
const FOLLOW_UP_CANCELLED_RE =
  /取消|黄了|黃了|没去|沒去|不去了|不用了|不考了|不面了|作罢|作罷|泡汤|泡湯|落空|没成|沒成|算了/;

const DAY_MS = 86_400_000;

/**
 * 给 open_loop 记忆推一个「该回访」时间：优先识别相对日期（明天/后天/下周/N天后），
 * 否则识别事件关键词给次日默认；都识别不到返回 null（不主动回访）。
 */
export function parseFollowUpAt(card: StructuredMemoryCard, now: Date): Date | null {
  if (card.memoryType !== "open_loop") return null;
  const text = `${card.title} ${card.description} ${card.keywords.join(" ")}`;
  if (FOLLOW_UP_CANCELLED_RE.test(text)) return null;
  const explicit = text.match(/(\d{1,2})\s*天[后後之]/);
  if (explicit) {
    const n = Number(explicit[1]);
    if (n >= 1 && n <= 30) return new Date(now.getTime() + n * DAY_MS);
  }
  for (const pattern of FOLLOW_UP_DAY_PATTERNS) {
    if (pattern.re.test(text)) return new Date(now.getTime() + pattern.days * DAY_MS);
  }
  if (FOLLOW_UP_EVENT_RE.test(text)) return new Date(now.getTime() + DAY_MS);
  return null;
}

export async function consolidateMemoryAfterTurn(input: MemoryConsolidationInput): Promise<MemoryConsolidationResult> {
  const now = new Date();
  const gate = shouldAttemptMemoryConsolidation(input);
  if (!gate.attempt) {
    const status = input.sourceRecallUsed && input.turnPlan.intent !== "correction"
      ? "skipped_source_guard"
      : "skipped_low_signal";
    return defaultResult(status, gate.reason, false);
  }

  try {
    const response = await llmService.invoke({
      messages: [
        {
          role: "system",
          content: [
            "你是保守的长期记忆沉淀助手。你只返回严格 JSON，不要 Markdown。宁可少写，不要污染记忆。",
            buildCurrentUserIdentityOverride("长期记忆用户身份覆盖"),
          ].join("\n\n"),
        },
        { role: "user", content: buildConsolidationPrompt(input) },
      ],
      options: {
        provider: (input.persona as any).llmProvider || undefined,
        purpose: "memory_extract",
        userId: input.userId,
        personaId: input.persona.id,
        route: "memory.after_turn",
        temperature: 0.15,
        maxTokens: 650,
      },
    });

    const rawCards = parseStructuredMemoryCardsResponse(response, {
      date: localDateKey(),
      source: "chat",
      memoryType: "relationship_event",
      category: "memory",
      evidenceMessageIds: [input.userMessageId, input.assistantMessageId],
    }, 2);
    const cards = rawCards
      .map(card => ({
        ...card,
        source: "chat" as const,
        evidenceMessageIds: card.evidenceMessageIds.length > 0
          ? card.evidenceMessageIds
          : [input.userMessageId, input.assistantMessageId],
      }))
      .filter(isConservativeCard);
    if (cards.length === 0) {
      return defaultResult("skipped_no_cards", "模型没有产出足够重要且可信的记忆卡片。", true);
    }

    const existing = await db.getActiveMemoriesByPersonaId(input.persona.id, input.userId);
    const result = defaultResult("created", gate.reason, true);

    for (const card of cards) {
      const decision = decideMemoryGovernance(card, existing as any);
      result.decisions.push(decision);
      result.cards.push({
        title: card.title,
        memoryType: card.memoryType,
        importance: card.importance,
        confidence: card.confidence,
        keywords: card.keywords,
      });

      if (decision.action === "skip_duplicate") {
        if (decision.duplicateOf) result.skippedDuplicateIds.push(decision.duplicateOf);
        continue;
      }

      for (const id of decision.archiveIds) {
        await db.updateMemory(id, input.userId, { status: "archived" });
        result.archivedMemoryIds.push(id);
      }
      for (const id of decision.contradictIds) {
        await db.updateMemory(id, input.userId, { status: "contradicted", confidence: 1 });
        result.contradictedMemoryIds.push(id);
      }

      const insert = structuredMemoryToInsert(card, input.persona.id, input.userId);
      const followUpAt = parseFollowUpAt(card, now);
      const memoryId = await db.createMemory(followUpAt ? { ...insert, followUpAt } : insert);
      result.createdMemoryIds.push(memoryId);
    }

    if (result.createdMemoryIds.length === 0) {
      result.status = "skipped_duplicate";
      result.reason = result.skippedDuplicateIds.length > 0
        ? "候选记忆与已有记忆重复，未写入。"
        : "候选记忆未通过治理规则，未写入。";
    }

    return result;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[MemoryConsolidation] failed persona=${input.persona.id}: ${reason}`);
    return defaultResult("failed", reason, true);
  }
}
