import type { LLMContentPart, LLMMessage, LLMPurpose } from "./types";

export type LlmUsageRecord = {
  id: number;
  startedAt: string;
  durationMs: number;
  provider: string;
  requestedProvider?: string;
  model?: string;
  purpose?: LLMPurpose;
  userId?: number;
  personaId?: number;
  route?: string;
  success: boolean;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputChars: number;
  outputChars: number;
  error?: string;
};

export type LlmUsageSnapshot = {
  today: {
    calls: number;
    successfulCalls: number;
    failedCalls: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    averageDurationMs: number;
  };
  byProvider: Array<{ provider: string; calls: number; totalTokens: number; averageDurationMs: number }>;
  byPurpose: Array<{ purpose: string; calls: number; totalTokens: number; averageDurationMs: number }>;
  byUser: Array<{ userId: number | null; calls: number; totalTokens: number; averageDurationMs: number }>;
  byPersona: Array<{ personaId: number | null; calls: number; totalTokens: number; averageDurationMs: number }>;
  byRoute: Array<{ route: string; calls: number; totalTokens: number; averageDurationMs: number }>;
  recent: LlmUsageRecord[];
};

export type LlmUsageDetailFilters = {
  from?: string;
  to?: string;
  userId?: number | null;
  personaId?: number | null;
  route?: string;
  provider?: string;
  purpose?: string;
  success?: boolean;
  limit?: number;
};

export type LlmUsageDetails = {
  source: "in-memory-runtime";
  filters: LlmUsageDetailFilters;
  summary: {
    calls: number;
    successfulCalls: number;
    failedCalls: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    averageDurationMs: number;
  };
  records: LlmUsageRecord[];
};

const MAX_RECORDS = 300;
const records: LlmUsageRecord[] = [];
let nextId = 1;
let persistentRecorder: ((record: LlmUsageRecord) => Promise<void> | void) | null = null;

function textLength(content: string | LLMContentPart[]): number {
  if (typeof content === "string") return Array.from(content).length;
  return content.reduce((total, part) => {
    if (part.type === "text") return total + Array.from(part.text).length;
    return total + 420;
  }, 0);
}

function estimateTokens(chars: number): number {
  return Math.max(1, Math.ceil(chars / 1.7));
}

export function estimateLlmInput(messages: LLMMessage[]): { chars: number; tokens: number } {
  const chars = messages.reduce((total, message) => total + textLength(message.content), 0);
  return { chars, tokens: estimateTokens(chars) };
}

export function estimateLlmOutput(text: string | undefined | null): { chars: number; tokens: number } {
  const chars = Array.from(text || "").length;
  return { chars, tokens: chars > 0 ? estimateTokens(chars) : 0 };
}

export function recordLlmUsage(data: Omit<LlmUsageRecord, "id" | "totalTokens">) {
  const record: LlmUsageRecord = {
    ...data,
    id: nextId++,
    totalTokens: data.inputTokens + data.outputTokens,
  };
  records.unshift(record);
  if (records.length > MAX_RECORDS) records.length = MAX_RECORDS;
  if (persistentRecorder) {
    void Promise.resolve(persistentRecorder(record)).catch(error => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("[LLM usage] Failed to persist usage record:", message);
    });
  }
}

export function setLlmUsagePersistentRecorder(
  recorder: ((record: LlmUsageRecord) => Promise<void> | void) | null,
) {
  persistentRecorder = recorder;
}

export function resetLlmUsageForTests() {
  records.length = 0;
  nextId = 1;
}

function averageDuration(items: LlmUsageRecord[]): number {
  if (items.length === 0) return 0;
  return Math.round(items.reduce((sum, item) => sum + item.durationMs, 0) / items.length);
}

function bucketBy(
  items: LlmUsageRecord[],
  key: (item: LlmUsageRecord) => string,
): Array<{ key: string; calls: number; totalTokens: number; averageDurationMs: number }> {
  const buckets = new Map<string, LlmUsageRecord[]>();
  for (const item of items) {
    const bucketKey = key(item) || "unknown";
    buckets.set(bucketKey, [...(buckets.get(bucketKey) || []), item]);
  }
  return Array.from(buckets.entries())
    .map(([bucketKey, bucketItems]) => ({
      key: bucketKey,
      calls: bucketItems.length,
      totalTokens: bucketItems.reduce((sum, item) => sum + item.totalTokens, 0),
      averageDurationMs: averageDuration(bucketItems),
    }))
    .sort((a, b) => b.calls - a.calls || b.totalTokens - a.totalTokens);
}

export function getLlmUsageSnapshot(now = new Date()): LlmUsageSnapshot {
  const todayKey = now.toISOString().slice(0, 10);
  const todayRecords = records.filter(item => item.startedAt.slice(0, 10) === todayKey);
  const successfulCalls = todayRecords.filter(item => item.success).length;
  const providerBuckets = bucketBy(todayRecords, item => item.provider).map(item => ({
    provider: item.key,
    calls: item.calls,
    totalTokens: item.totalTokens,
    averageDurationMs: item.averageDurationMs,
  }));
  const purposeBuckets = bucketBy(todayRecords, item => item.purpose || "unknown").map(item => ({
    purpose: item.key,
    calls: item.calls,
    totalTokens: item.totalTokens,
    averageDurationMs: item.averageDurationMs,
  }));
  const userBuckets = bucketBy(todayRecords, item => item.userId == null ? "unassigned" : String(item.userId)).map(item => ({
    userId: item.key === "unassigned" ? null : Number(item.key),
    calls: item.calls,
    totalTokens: item.totalTokens,
    averageDurationMs: item.averageDurationMs,
  }));
  const personaBuckets = bucketBy(todayRecords, item => item.personaId == null ? "unassigned" : String(item.personaId)).map(item => ({
    personaId: item.key === "unassigned" ? null : Number(item.key),
    calls: item.calls,
    totalTokens: item.totalTokens,
    averageDurationMs: item.averageDurationMs,
  }));
  const routeBuckets = bucketBy(todayRecords, item => item.route || "unknown").map(item => ({
    route: item.key,
    calls: item.calls,
    totalTokens: item.totalTokens,
    averageDurationMs: item.averageDurationMs,
  }));

  return {
    today: {
      calls: todayRecords.length,
      successfulCalls,
      failedCalls: todayRecords.length - successfulCalls,
      inputTokens: todayRecords.reduce((sum, item) => sum + item.inputTokens, 0),
      outputTokens: todayRecords.reduce((sum, item) => sum + item.outputTokens, 0),
      totalTokens: todayRecords.reduce((sum, item) => sum + item.totalTokens, 0),
      averageDurationMs: averageDuration(todayRecords),
    },
    byProvider: providerBuckets,
    byPurpose: purposeBuckets,
    byUser: userBuckets,
    byPersona: personaBuckets,
    byRoute: routeBuckets,
    recent: records.slice(0, 20),
  };
}

function parseFilterDate(value: string | undefined): Date | null {
  if (!value?.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function matchesTextFilter(value: string | undefined, filter: string | undefined): boolean {
  const normalized = filter?.trim().toLowerCase();
  if (!normalized) return true;
  return (value || "").toLowerCase().includes(normalized);
}

function matchesOptionalNumber(value: number | undefined, filter: number | null | undefined): boolean {
  if (filter === undefined) return true;
  if (filter === null) return value == null;
  return value === filter;
}

export function getLlmUsageDetails(filters: LlmUsageDetailFilters = {}): LlmUsageDetails {
  const from = parseFilterDate(filters.from);
  const to = parseFilterDate(filters.to);
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const filtered = records.filter(record => {
    const startedAt = new Date(record.startedAt);
    if (from && startedAt < from) return false;
    if (to && startedAt > to) return false;
    if (!matchesOptionalNumber(record.userId, filters.userId)) return false;
    if (!matchesOptionalNumber(record.personaId, filters.personaId)) return false;
    if (filters.success !== undefined && record.success !== filters.success) return false;
    if (!matchesTextFilter(record.route, filters.route)) return false;
    if (!matchesTextFilter(record.provider, filters.provider)) return false;
    if (!matchesTextFilter(record.purpose, filters.purpose)) return false;
    return true;
  });
  const successfulCalls = filtered.filter(record => record.success).length;

  return {
    source: "in-memory-runtime",
    filters: {
      ...filters,
      limit,
    },
    summary: {
      calls: filtered.length,
      successfulCalls,
      failedCalls: filtered.length - successfulCalls,
      inputTokens: filtered.reduce((sum, record) => sum + record.inputTokens, 0),
      outputTokens: filtered.reduce((sum, record) => sum + record.outputTokens, 0),
      totalTokens: filtered.reduce((sum, record) => sum + record.totalTokens, 0),
      averageDurationMs: averageDuration(filtered),
    },
    records: filtered.slice(0, limit),
  };
}
