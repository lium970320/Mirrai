import type { InsertMemory } from "../../drizzle/schema";

export type MemorySource =
  | "manual"
  | "chat"
  | "daily_summary"
  | "source_material"
  | "import"
  | "system";

export type MemoryType =
  | "user_fact"
  | "relationship_event"
  | "promise"
  | "preference"
  | "emotional_moment"
  | "conflict"
  | "open_loop"
  | "persona_background"
  | "source_fact"
  | "daily_summary";

export type MemoryStatus = "active" | "archived" | "contradicted";

export type StructuredMemoryCard = {
  title: string;
  description: string;
  category: "milestone" | "memory" | "anniversary";
  date?: string;
  source: MemorySource;
  memoryType: MemoryType;
  importance: number;
  confidence: number;
  keywords: string[];
  emotion?: string;
  validFrom?: string;
  validTo?: string;
  evidenceMessageIds: number[];
  status: MemoryStatus;
};

export type StructuredMemoryDefaults = {
  date?: string;
  source?: MemorySource;
  memoryType?: MemoryType;
  category?: "milestone" | "memory" | "anniversary";
  evidenceMessageIds?: number[];
};

const MEMORY_SOURCES = new Set<MemorySource>([
  "manual",
  "chat",
  "daily_summary",
  "source_material",
  "import",
  "system",
]);

const MEMORY_TYPES = new Set<MemoryType>([
  "user_fact",
  "relationship_event",
  "promise",
  "preference",
  "emotional_moment",
  "conflict",
  "open_loop",
  "persona_background",
  "source_fact",
  "daily_summary",
]);

const MEMORY_STATUSES = new Set<MemoryStatus>(["active", "archived", "contradicted"]);

export const MEMORY_TYPE_LABELS: Record<MemoryType, string> = {
  user_fact: "用户事实",
  relationship_event: "关系事件",
  promise: "承诺约定",
  preference: "偏好习惯",
  emotional_moment: "情绪节点",
  conflict: "冲突修复",
  open_loop: "未完成话题",
  persona_background: "人物背景",
  source_fact: "原著资料",
  daily_summary: "每日总结",
};

export const MEMORY_SOURCE_LABELS: Record<MemorySource, string> = {
  manual: "手动",
  chat: "聊天",
  daily_summary: "每日整理",
  source_material: "资料",
  import: "导入",
  system: "系统",
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function textValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function intValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clampRating(value: unknown, fallback = 3): number {
  const int = Math.trunc(intValue(value, fallback));
  return Math.min(5, Math.max(1, int));
}

function compact(text: string, maxLength: number): string {
  const chars = Array.from(text.replace(/\s+/g, " ").trim());
  return chars.length <= maxLength
    ? chars.join("")
    : `${chars.slice(0, maxLength).join("")}...`;
}

function normalizeSource(value: unknown, fallback: MemorySource): MemorySource {
  const normalized = textValue(value).toLowerCase();
  return MEMORY_SOURCES.has(normalized as MemorySource) ? normalized as MemorySource : fallback;
}

function normalizeType(value: unknown, fallback: MemoryType): MemoryType {
  const normalized = textValue(value).toLowerCase();
  return MEMORY_TYPES.has(normalized as MemoryType) ? normalized as MemoryType : fallback;
}

function normalizeStatus(value: unknown): MemoryStatus {
  const normalized = textValue(value).toLowerCase();
  return MEMORY_STATUSES.has(normalized as MemoryStatus) ? normalized as MemoryStatus : "active";
}

function normalizeCategory(value: unknown, fallback: "milestone" | "memory" | "anniversary") {
  const normalized = textValue(value).toLowerCase();
  return normalized === "milestone" || normalized === "memory" || normalized === "anniversary"
    ? normalized
    : fallback;
}

function normalizeKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .map(item => textValue(item))
      .filter(Boolean)
      .map(item => compact(item, 24)),
  )).slice(0, 12);
}

function normalizeEvidenceIds(value: unknown, fallback: number[]): number[] {
  const source = Array.isArray(value) ? value : fallback;
  return Array.from(new Set(
    source
      .map(item => typeof item === "number" ? Math.trunc(item) : Number(item))
      .filter(item => Number.isInteger(item) && item > 0),
  )).slice(0, 80);
}

function defaultCategoryForType(type: MemoryType): "milestone" | "memory" | "anniversary" {
  if (type === "promise" || type === "conflict") return "milestone";
  return "memory";
}

export function normalizeStructuredMemoryCard(
  rawValue: unknown,
  defaults: StructuredMemoryDefaults = {},
): StructuredMemoryCard | null {
  const raw = asRecord(rawValue);
  const fallbackType = defaults.memoryType ?? "relationship_event";
  const memoryType = normalizeType(raw.memoryType ?? raw.type, fallbackType);
  const title = compact(textValue(raw.title, "记忆"), 160);
  const description = compact(textValue(raw.description ?? raw.content ?? raw.summary), 1800);
  if (!title || !description) return null;

  return {
    title,
    description,
    category: normalizeCategory(raw.category, defaults.category ?? defaultCategoryForType(memoryType)),
    date: compact(textValue(raw.date, defaults.date ?? ""), 50) || undefined,
    source: normalizeSource(raw.source, defaults.source ?? "manual"),
    memoryType,
    importance: clampRating(raw.importance, 3),
    confidence: clampRating(raw.confidence, 3),
    keywords: normalizeKeywords(raw.keywords),
    emotion: compact(textValue(raw.emotion), 50) || undefined,
    validFrom: compact(textValue(raw.validFrom), 50) || undefined,
    validTo: compact(textValue(raw.validTo), 50) || undefined,
    evidenceMessageIds: normalizeEvidenceIds(raw.evidenceMessageIds ?? raw.messageIds, defaults.evidenceMessageIds ?? []),
    status: normalizeStatus(raw.status),
  };
}

function stripCodeFence(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function parseJsonPayload(text: string): unknown | null {
  const stripped = stripCodeFence(text || "");
  if (!stripped) return null;
  try {
    return JSON.parse(stripped);
  } catch {
    // Continue to best-effort extraction below.
  }

  const arrayMatch = stripped.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      return JSON.parse(arrayMatch[0]);
    } catch {
      // Continue to object extraction.
    }
  }

  const objectMatch = stripped.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      return JSON.parse(objectMatch[0]);
    } catch {
      return null;
    }
  }

  return null;
}

export function parseStructuredMemoryCardsResponse(
  text: string,
  defaults: StructuredMemoryDefaults = {},
  limit = 8,
): StructuredMemoryCard[] {
  const payload = parseJsonPayload(text);
  const root = asRecord(payload);
  const values = Array.isArray(payload)
    ? payload
    : Array.isArray(root.memories)
      ? root.memories
      : Array.isArray(root.cards)
        ? root.cards
        : payload
          ? [payload]
          : [];

  return values
    .map(item => normalizeStructuredMemoryCard(item, defaults))
    .filter(Boolean)
    .slice(0, limit) as StructuredMemoryCard[];
}

export function structuredMemoryToInsert(
  card: StructuredMemoryCard,
  personaId: number,
  userId: number,
): InsertMemory {
  return {
    personaId,
    userId,
    title: card.title,
    description: card.description,
    category: card.category,
    date: card.date,
    source: card.source,
    memoryType: card.memoryType,
    importance: card.importance,
    confidence: card.confidence,
    keywords: card.keywords.length > 0 ? card.keywords : undefined,
    emotion: card.emotion,
    validFrom: card.validFrom,
    validTo: card.validTo,
    evidenceMessageIds: card.evidenceMessageIds.length > 0 ? card.evidenceMessageIds : undefined,
    status: card.status,
  };
}

