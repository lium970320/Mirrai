import { eq, desc, and, or, sql, count, sum, gte, ilike, asc, inArray, lte, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  InsertUser, users,
  personas, personaFiles, messages,
  roleplayChannels, roleplayChannelMembers, roleplayMessages,
  personaRuntimeStates,
  personaSources, personaSourceChunks,
  wechatBindings, skillJobs, llmConfigs, wechatBotState,
  llmUsageRecords, memories, emotionSnapshots, diaryEntries, scenes,
  InsertPersona, InsertPersonaFile, InsertMessage,
  InsertRoleplayChannel, InsertRoleplayChannelMember, InsertRoleplayMessage,
  InsertPersonaSource, InsertPersonaSourceChunk,
  InsertWechatBinding, InsertSkillJob, InsertLlmConfig,
  InsertLlmUsageRecordRow,
  InsertMemory, InsertEmotionSnapshot, InsertDiaryEntry, InsertScene,
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import { DEFAULT_SOURCE_TERMS } from "./_core/persona-life-config";
import {
  extractPersonaRuntimeForStorage,
  getProactiveMessageConfig,
  mergePersonaRuntimeIntoPersonaData,
} from "./_core/persona-runtime";
import { shouldDeactivateRoleplayChannelAfterMemberRemoval } from "./social/roleplay-channel-policy";

let _db: ReturnType<typeof drizzle> | null = null;

function isTransientDbError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return /econnreset|econnrefused|etimedout|connection terminated|socket hang up|too many clients/.test(msg);
}

export async function getDb() {
  if (_db) return _db;
  if (!process.env.DATABASE_URL) return null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
      return _db;
    } catch (error) {
      if (attempt < 2 && isTransientDbError(error)) {
        const delay = 100 * Math.pow(2, attempt);
        console.warn(`[Database] Connection attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      console.warn("[Database] Failed to connect:", error);
      _db = null;
      return null;
    }
  }
  return null;
}

export async function withRetry<T>(operation: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      if (isTransientDbError(err) && attempt < maxRetries) {
        _db = null;
        const delay = 100 * Math.pow(2, attempt);
        console.warn(`[Database] Transient error, reconnecting in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

// ─── LLM usage helpers ─────────────────────────────────────────────────────

let llmUsageTableEnsured = false;

export async function ensureLlmUsageTable() {
  if (llmUsageTableEnsured) return;
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "llm_usage_records" (
      "id" serial PRIMARY KEY NOT NULL,
      "startedAt" timestamp NOT NULL,
      "durationMs" integer DEFAULT 0 NOT NULL,
      "provider" varchar(64) NOT NULL,
      "requestedProvider" varchar(64),
      "model" varchar(128),
      "purpose" varchar(64),
      "userId" integer,
      "personaId" integer,
      "route" varchar(128),
      "success" boolean DEFAULT true NOT NULL,
      "inputTokens" integer DEFAULT 0 NOT NULL,
      "outputTokens" integer DEFAULT 0 NOT NULL,
      "totalTokens" integer DEFAULT 0 NOT NULL,
      "inputChars" integer DEFAULT 0 NOT NULL,
      "outputChars" integer DEFAULT 0 NOT NULL,
      "error" text,
      "createdAt" timestamp DEFAULT now() NOT NULL
    )
  `);
  await db.execute(sql`ALTER TABLE "llm_usage_records" ADD COLUMN IF NOT EXISTS "userId" integer`);
  await db.execute(sql`ALTER TABLE "llm_usage_records" ADD COLUMN IF NOT EXISTS "personaId" integer`);
  await db.execute(sql`ALTER TABLE "llm_usage_records" ADD COLUMN IF NOT EXISTS "route" varchar(128)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "llm_usage_started_at_idx" ON "llm_usage_records" ("startedAt")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "llm_usage_provider_started_idx" ON "llm_usage_records" ("provider", "startedAt")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "llm_usage_purpose_started_idx" ON "llm_usage_records" ("purpose", "startedAt")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "llm_usage_user_started_idx" ON "llm_usage_records" ("userId", "startedAt")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "llm_usage_persona_started_idx" ON "llm_usage_records" ("personaId", "startedAt")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "llm_usage_route_started_idx" ON "llm_usage_records" ("route", "startedAt")`);

  llmUsageTableEnsured = true;
}

export async function createLlmUsageRecord(data: InsertLlmUsageRecordRow) {
  await ensureLlmUsageTable();
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.insert(llmUsageRecords).values(data);
}

// ─── Persona runtime state helpers ─────────────────────────────────────────

let personaRuntimeStatesTableEnsured = false;

export async function ensurePersonaRuntimeStatesTable() {
  if (personaRuntimeStatesTableEnsured) return;
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "persona_runtime_states" (
      "id" serial PRIMARY KEY NOT NULL,
      "personaId" integer NOT NULL,
      "userId" integer NOT NULL,
      "runtimeLifeState" jsonb,
      "runtimeDiagnostics" jsonb,
      "runtimeInnerState" jsonb,
      "proactiveRuntime" jsonb,
      "createdAt" timestamp DEFAULT now() NOT NULL,
      "updatedAt" timestamp DEFAULT now() NOT NULL
    )
  `);
  // 已存在的表通过幂等加列升级（CREATE TABLE IF NOT EXISTS 不会补列）。
  await db.execute(sql`ALTER TABLE "persona_runtime_states" ADD COLUMN IF NOT EXISTS "runtimeInnerState" jsonb`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "persona_runtime_states_persona_user_idx" ON "persona_runtime_states" ("personaId", "userId")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "persona_runtime_states_user_idx" ON "persona_runtime_states" ("userId")`);
  personaRuntimeStatesTableEnsured = true;
}

async function getPersonaRuntimeStateRow(personaId: number, userId: number) {
  await ensurePersonaRuntimeStatesTable();
  const db = await getDb();
  if (!db) return undefined;
  const [row] = await db.select().from(personaRuntimeStates)
    .where(and(eq(personaRuntimeStates.personaId, personaId), eq(personaRuntimeStates.userId, userId)))
    .limit(1);
  return row;
}

async function upsertPersonaRuntimeState(
  personaId: number,
  userId: number,
  runtime: {
    runtimeLifeState?: unknown | null;
    runtimeDiagnostics?: unknown | null;
    runtimeInnerState?: unknown | null;
    proactiveRuntime?: unknown | null;
  },
) {
  await ensurePersonaRuntimeStatesTable();
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const existing = await getPersonaRuntimeStateRow(personaId, userId);
  const data = {
    personaId,
    userId,
    runtimeLifeState: runtime.runtimeLifeState ?? null,
    runtimeDiagnostics: runtime.runtimeDiagnostics ?? null,
    runtimeInnerState: runtime.runtimeInnerState ?? null,
    proactiveRuntime: runtime.proactiveRuntime ?? null,
    updatedAt: new Date(),
  };
  if (existing) {
    await db.update(personaRuntimeStates)
      .set(data)
      .where(and(eq(personaRuntimeStates.personaId, personaId), eq(personaRuntimeStates.userId, userId)));
  } else {
    await db.insert(personaRuntimeStates).values(data as any);
  }
}

function mergePersonaRuntimeRow<T extends { personaData: unknown; id: number; userId: number }>(
  persona: T,
  runtime: Awaited<ReturnType<typeof getPersonaRuntimeStateRow>>,
): T {
  if (!runtime) return persona;
  return {
    ...persona,
    personaData: mergePersonaRuntimeIntoPersonaData(persona.personaData, {
      runtimeLifeState: runtime.runtimeLifeState,
      runtimeDiagnostics: runtime.runtimeDiagnostics,
      runtimeInnerState: runtime.runtimeInnerState,
      proactiveRuntime: runtime.proactiveRuntime,
    }),
  };
}

async function mergePersonaRuntimeRows<T extends { personaData: unknown; id: number; userId: number }>(
  list: T[],
): Promise<T[]> {
  if (list.length === 0) return list;
  await ensurePersonaRuntimeStatesTable();
  const db = await getDb();
  if (!db) return list;

  const personaIds = Array.from(new Set(list.map(persona => persona.id)));
  const userIds = Array.from(new Set(list.map(persona => persona.userId)));
  const runtimeRows = await db.select().from(personaRuntimeStates)
    .where(and(
      inArray(personaRuntimeStates.personaId, personaIds),
      inArray(personaRuntimeStates.userId, userIds),
    ));
  const runtimeByPersona = new Map(runtimeRows.map(row => [`${row.personaId}:${row.userId}`, row] as const));
  return list.map(persona => mergePersonaRuntimeRow(persona, runtimeByPersona.get(`${persona.id}:${persona.userId}`)));
}

export type LlmUsagePeriodSummary = {
  calls: number;
  successfulCalls: number;
  failedCalls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  averageDurationMs: number;
};

export type LlmUsageBucketSummary = {
  name: string;
  calls: number;
  totalTokens: number;
  averageDurationMs: number;
};

export type PersistentLlmUsageSnapshot = {
  source: "database";
  today: LlmUsagePeriodSummary;
  week: LlmUsagePeriodSummary;
  month: LlmUsagePeriodSummary;
  byProvider: Array<LlmUsageBucketSummary & { provider: string }>;
  byPurpose: Array<LlmUsageBucketSummary & { purpose: string }>;
  byUser: Array<LlmUsageBucketSummary & { userId: number | null }>;
  byPersona: Array<LlmUsageBucketSummary & { personaId: number | null }>;
  byRoute: Array<LlmUsageBucketSummary & { route: string }>;
  recent: Array<{
    id: number;
    startedAt: string;
    durationMs: number;
    provider: string;
    requestedProvider?: string;
    model?: string;
    purpose?: string;
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
  }>;
};

export type LlmUsageDetailQuery = {
  from?: Date;
  to?: Date;
  userId?: number | null;
  personaId?: number | null;
  route?: string;
  provider?: string;
  purpose?: string;
  success?: boolean;
  limit?: number;
};

export type PersistentLlmUsageDetails = {
  source: "database";
  filters: {
    from?: string;
    to?: string;
    userId?: number | null;
    personaId?: number | null;
    route?: string;
    provider?: string;
    purpose?: string;
    success?: boolean;
    limit: number;
  };
  summary: LlmUsagePeriodSummary;
  records: PersistentLlmUsageSnapshot["recent"];
};

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function daysAgoUtc(date: Date, days: number) {
  const start = startOfUtcDay(date);
  start.setUTCDate(start.getUTCDate() - days);
  return start;
}

function numbersFromSummary(row: {
  calls: number;
  successfulCalls: number;
  inputTokens: string | number | null;
  outputTokens: string | number | null;
  totalTokens: string | number | null;
  averageDurationMs: string | number | null;
} | undefined): LlmUsagePeriodSummary {
  const calls = Number(row?.calls ?? 0);
  const successfulCalls = Number(row?.successfulCalls ?? 0);
  return {
    calls,
    successfulCalls,
    failedCalls: Math.max(0, calls - successfulCalls),
    inputTokens: Number(row?.inputTokens ?? 0),
    outputTokens: Number(row?.outputTokens ?? 0),
    totalTokens: Number(row?.totalTokens ?? 0),
    averageDurationMs: Math.round(Number(row?.averageDurationMs ?? 0)),
  };
}

async function summarizeLlmUsageSince(since: Date): Promise<LlmUsagePeriodSummary> {
  const db = await getDb();
  if (!db) return numbersFromSummary(undefined);
  const [row] = await db.select({
    calls: count(),
    successfulCalls: sql<number>`count(*) filter (where ${llmUsageRecords.success})::int`,
    inputTokens: sum(llmUsageRecords.inputTokens),
    outputTokens: sum(llmUsageRecords.outputTokens),
    totalTokens: sum(llmUsageRecords.totalTokens),
    averageDurationMs: sql<number>`coalesce(avg(${llmUsageRecords.durationMs}), 0)`,
  })
    .from(llmUsageRecords)
    .where(gte(llmUsageRecords.startedAt, since));
  return numbersFromSummary(row);
}

export async function getPersistentLlmUsageSnapshot(now = new Date()): Promise<PersistentLlmUsageSnapshot | null> {
  const db = await getDb();
  if (!db) return null;
  await ensureLlmUsageTable();

  const todayStart = startOfUtcDay(now);
  const weekStart = daysAgoUtc(now, 6);
  const monthStart = daysAgoUtc(now, 29);
  const [today, week, month] = await Promise.all([
    summarizeLlmUsageSince(todayStart),
    summarizeLlmUsageSince(weekStart),
    summarizeLlmUsageSince(monthStart),
  ]);

  const providerRows = await db.select({
    provider: llmUsageRecords.provider,
    calls: count(),
    totalTokens: sum(llmUsageRecords.totalTokens),
    averageDurationMs: sql<number>`coalesce(avg(${llmUsageRecords.durationMs}), 0)`,
  })
    .from(llmUsageRecords)
    .where(gte(llmUsageRecords.startedAt, todayStart))
    .groupBy(llmUsageRecords.provider)
    .orderBy(desc(count()), desc(sum(llmUsageRecords.totalTokens)))
    .limit(12);

  const purposeRows = await db.select({
    purpose: sql<string>`coalesce(${llmUsageRecords.purpose}, 'unknown')`,
    calls: count(),
    totalTokens: sum(llmUsageRecords.totalTokens),
    averageDurationMs: sql<number>`coalesce(avg(${llmUsageRecords.durationMs}), 0)`,
  })
    .from(llmUsageRecords)
    .where(gte(llmUsageRecords.startedAt, todayStart))
    .groupBy(sql`coalesce(${llmUsageRecords.purpose}, 'unknown')`)
    .orderBy(desc(count()), desc(sum(llmUsageRecords.totalTokens)))
    .limit(12);

  const userRows = await db.select({
    userId: llmUsageRecords.userId,
    calls: count(),
    totalTokens: sum(llmUsageRecords.totalTokens),
    averageDurationMs: sql<number>`coalesce(avg(${llmUsageRecords.durationMs}), 0)`,
  })
    .from(llmUsageRecords)
    .where(gte(llmUsageRecords.startedAt, todayStart))
    .groupBy(llmUsageRecords.userId)
    .orderBy(desc(count()), desc(sum(llmUsageRecords.totalTokens)))
    .limit(12);

  const personaRows = await db.select({
    personaId: llmUsageRecords.personaId,
    calls: count(),
    totalTokens: sum(llmUsageRecords.totalTokens),
    averageDurationMs: sql<number>`coalesce(avg(${llmUsageRecords.durationMs}), 0)`,
  })
    .from(llmUsageRecords)
    .where(gte(llmUsageRecords.startedAt, todayStart))
    .groupBy(llmUsageRecords.personaId)
    .orderBy(desc(count()), desc(sum(llmUsageRecords.totalTokens)))
    .limit(12);

  const routeRows = await db.select({
    route: sql<string>`coalesce(${llmUsageRecords.route}, 'unknown')`,
    calls: count(),
    totalTokens: sum(llmUsageRecords.totalTokens),
    averageDurationMs: sql<number>`coalesce(avg(${llmUsageRecords.durationMs}), 0)`,
  })
    .from(llmUsageRecords)
    .where(gte(llmUsageRecords.startedAt, todayStart))
    .groupBy(sql`coalesce(${llmUsageRecords.route}, 'unknown')`)
    .orderBy(desc(count()), desc(sum(llmUsageRecords.totalTokens)))
    .limit(12);

  const recentRows = await db.select().from(llmUsageRecords)
    .orderBy(desc(llmUsageRecords.startedAt), desc(llmUsageRecords.id))
    .limit(20);

  return {
    source: "database",
    today,
    week,
    month,
    byProvider: providerRows.map(row => ({
      name: row.provider,
      provider: row.provider,
      calls: Number(row.calls ?? 0),
      totalTokens: Number(row.totalTokens ?? 0),
      averageDurationMs: Math.round(Number(row.averageDurationMs ?? 0)),
    })),
    byPurpose: purposeRows.map(row => ({
      name: row.purpose,
      purpose: row.purpose,
      calls: Number(row.calls ?? 0),
      totalTokens: Number(row.totalTokens ?? 0),
      averageDurationMs: Math.round(Number(row.averageDurationMs ?? 0)),
    })),
    byUser: userRows.map(row => ({
      name: row.userId == null ? "unassigned" : String(row.userId),
      userId: row.userId ?? null,
      calls: Number(row.calls ?? 0),
      totalTokens: Number(row.totalTokens ?? 0),
      averageDurationMs: Math.round(Number(row.averageDurationMs ?? 0)),
    })),
    byPersona: personaRows.map(row => ({
      name: row.personaId == null ? "unassigned" : String(row.personaId),
      personaId: row.personaId ?? null,
      calls: Number(row.calls ?? 0),
      totalTokens: Number(row.totalTokens ?? 0),
      averageDurationMs: Math.round(Number(row.averageDurationMs ?? 0)),
    })),
    byRoute: routeRows.map(row => ({
      name: row.route,
      route: row.route,
      calls: Number(row.calls ?? 0),
      totalTokens: Number(row.totalTokens ?? 0),
      averageDurationMs: Math.round(Number(row.averageDurationMs ?? 0)),
    })),
    recent: recentRows.map(row => ({
      id: row.id,
      startedAt: row.startedAt.toISOString(),
      durationMs: row.durationMs,
      provider: row.provider,
      requestedProvider: row.requestedProvider || undefined,
      model: row.model || undefined,
      purpose: row.purpose || undefined,
      userId: row.userId ?? undefined,
      personaId: row.personaId ?? undefined,
      route: row.route || undefined,
      success: row.success,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      totalTokens: row.totalTokens,
      inputChars: row.inputChars,
      outputChars: row.outputChars,
      error: row.error || undefined,
    })),
  };
}

function llmUsageDetailWhere(query: LlmUsageDetailQuery) {
  const conditions: SQL[] = [];
  if (query.from) conditions.push(gte(llmUsageRecords.startedAt, query.from));
  if (query.to) conditions.push(lte(llmUsageRecords.startedAt, query.to));
  if (query.userId !== undefined) conditions.push(query.userId === null
    ? sql`${llmUsageRecords.userId} IS NULL`
    : eq(llmUsageRecords.userId, query.userId));
  if (query.personaId !== undefined) conditions.push(query.personaId === null
    ? sql`${llmUsageRecords.personaId} IS NULL`
    : eq(llmUsageRecords.personaId, query.personaId));
  if (query.route?.trim()) conditions.push(ilike(llmUsageRecords.route, `%${query.route.trim()}%`));
  if (query.provider?.trim()) conditions.push(ilike(llmUsageRecords.provider, `%${query.provider.trim()}%`));
  if (query.purpose?.trim()) conditions.push(ilike(llmUsageRecords.purpose, `%${query.purpose.trim()}%`));
  if (query.success !== undefined) conditions.push(eq(llmUsageRecords.success, query.success));
  return conditions.length > 0 ? and(...conditions)! : sql`true`;
}

function llmUsageRowToRecent(row: typeof llmUsageRecords.$inferSelect): PersistentLlmUsageSnapshot["recent"][number] {
  return {
    id: row.id,
    startedAt: row.startedAt.toISOString(),
    durationMs: row.durationMs,
    provider: row.provider,
    requestedProvider: row.requestedProvider || undefined,
    model: row.model || undefined,
    purpose: row.purpose || undefined,
    userId: row.userId ?? undefined,
    personaId: row.personaId ?? undefined,
    route: row.route || undefined,
    success: row.success,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    totalTokens: row.totalTokens,
    inputChars: row.inputChars,
    outputChars: row.outputChars,
    error: row.error || undefined,
  };
}

export async function getPersistentLlmUsageDetails(query: LlmUsageDetailQuery = {}): Promise<PersistentLlmUsageDetails | null> {
  const db = await getDb();
  if (!db) return null;
  await ensureLlmUsageTable();

  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const where = llmUsageDetailWhere(query);
  const [summaryRow] = await db.select({
    calls: count(),
    successfulCalls: sql<number>`count(*) filter (where ${llmUsageRecords.success})::int`,
    inputTokens: sum(llmUsageRecords.inputTokens),
    outputTokens: sum(llmUsageRecords.outputTokens),
    totalTokens: sum(llmUsageRecords.totalTokens),
    averageDurationMs: sql<number>`coalesce(avg(${llmUsageRecords.durationMs}), 0)`,
  })
    .from(llmUsageRecords)
    .where(where);

  const rows = await db.select().from(llmUsageRecords)
    .where(where)
    .orderBy(desc(llmUsageRecords.startedAt), desc(llmUsageRecords.id))
    .limit(limit);

  return {
    source: "database",
    filters: {
      from: query.from?.toISOString(),
      to: query.to?.toISOString(),
      userId: query.userId,
      personaId: query.personaId,
      route: query.route,
      provider: query.provider,
      purpose: query.purpose,
      success: query.success,
      limit,
    },
    summary: numbersFromSummary(summaryRow),
    records: rows.map(llmUsageRowToRecent),
  };
}

// ─── User helpers ───────────────────────────────────────────────────────────

export async function createUser(data: { username: string; passwordHash: string; name: string }) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(users).values({
    username: data.username,
    passwordHash: data.passwordHash,
    name: data.name,
    lastSignedIn: new Date(),
  }).returning({ id: users.id });
  return result.id;
}

export async function getUserByUsername(username: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.username, username)).limit(1);
  return result[0];
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result[0];
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function updateUserLastSignedIn(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, id));
}

export async function updateUserProfile(id: number, data: { name?: string; email?: string }) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(users).set(data).where(eq(users.id, id));
}

export async function updateUserPassword(id: number, passwordHash: string) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(users).set({ passwordHash }).where(eq(users.id, id));
}

export const USER_ACCOUNT_DELETE_SECTIONS = [
  "llmUsageRecords",
  "personaRuntimeStates",
  "memories",
  "emotionSnapshots",
  "diaryEntries",
  "roleplayMessages",
  "roleplayChannelMembers",
  "roleplayChannels",
  "messages",
  "personaFiles",
  "personaSourceChunks",
  "personaSources",
  "wechatBindings",
  "wechatBotState",
  "skillJobs",
  "llmConfigs",
  "scenes",
  "personas",
  "users",
] as const;

export async function deleteUserAccount(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await ensureRoleplayTables();
  await ensureLlmUsageTable();
  await ensurePersonaRuntimeStatesTable();
  const personaIdRows = await db.select({ id: personas.id }).from(personas).where(eq(personas.userId, id));
  const personaIds = personaIdRows.map(row => row.id);
  const usageScope = personaIds.length > 0
    ? or(eq(llmUsageRecords.userId, id), inArray(llmUsageRecords.personaId, personaIds))!
    : eq(llmUsageRecords.userId, id);
  await db.delete(llmUsageRecords).where(usageScope);
  await db.delete(personaRuntimeStates).where(eq(personaRuntimeStates.userId, id));
  await db.delete(memories).where(eq(memories.userId, id));
  await db.delete(emotionSnapshots).where(eq(emotionSnapshots.userId, id));
  await db.delete(diaryEntries).where(eq(diaryEntries.userId, id));
  await db.delete(roleplayMessages).where(eq(roleplayMessages.userId, id));
  await db.delete(roleplayChannelMembers).where(eq(roleplayChannelMembers.userId, id));
  await db.delete(roleplayChannels).where(eq(roleplayChannels.userId, id));
  await db.delete(messages).where(eq(messages.userId, id));
  await db.delete(personaFiles).where(eq(personaFiles.userId, id));
  await db.delete(personaSourceChunks).where(eq(personaSourceChunks.userId, id));
  await db.delete(personaSources).where(eq(personaSources.userId, id));
  await db.delete(wechatBindings).where(eq(wechatBindings.userId, id));
  await db.delete(wechatBotState).where(eq(wechatBotState.userId, id));
  await db.delete(skillJobs).where(eq(skillJobs.userId, id));
  await db.delete(llmConfigs).where(eq(llmConfigs.userId, id));
  await db.delete(scenes).where(eq(scenes.userId, id));
  await db.delete(personas).where(eq(personas.userId, id));
  await db.delete(users).where(eq(users.id, id));
}

export async function getAccountStats(userId: number) {
  const db = await getDb();
  if (!db) return {
    totalPersonas: 0,
    totalChats: 0,
    totalMessages: 0,
    totalFiles: 0,
    storageUsed: 0,
    totalMemories: 0,
    totalSources: 0,
    totalRoleplayChannels: 0,
    totalLlmUsageRecords: 0,
    totalRuntimeStates: 0,
  };
  await ensureRoleplayTables();
  await ensureLlmUsageTable();
  await ensurePersonaRuntimeStatesTable();
  const [personaCount] = await db.select({ c: count() }).from(personas).where(eq(personas.userId, userId));
  const [chatSum] = await db.select({ s: sum(personas.chatCount) }).from(personas).where(eq(personas.userId, userId));
  const [msgCount] = await db.select({ c: count() }).from(messages).where(eq(messages.userId, userId));
  const [fileCount] = await db.select({ c: count() }).from(personaFiles).where(eq(personaFiles.userId, userId));
  const [fileSize] = await db.select({ s: sum(personaFiles.fileSize) }).from(personaFiles).where(eq(personaFiles.userId, userId));
  const [memoryCount] = await db.select({ c: count() }).from(memories).where(eq(memories.userId, userId));
  const [sourceCount] = await db.select({ c: count() }).from(personaSources).where(eq(personaSources.userId, userId));
  const [roleplayCount] = await db.select({ c: count() }).from(roleplayChannels).where(eq(roleplayChannels.userId, userId));
  const [usageCount] = await db.select({ c: count() }).from(llmUsageRecords).where(eq(llmUsageRecords.userId, userId));
  const [runtimeStateCount] = await db.select({ c: count() }).from(personaRuntimeStates).where(eq(personaRuntimeStates.userId, userId));
  return {
    totalPersonas: personaCount?.c || 0,
    totalChats: Number(chatSum?.s) || 0,
    totalMessages: msgCount?.c || 0,
    totalFiles: fileCount?.c || 0,
    storageUsed: Number(fileSize?.s) || 0,
    totalMemories: memoryCount?.c || 0,
    totalSources: sourceCount?.c || 0,
    totalRoleplayChannels: roleplayCount?.c || 0,
    totalLlmUsageRecords: usageCount?.c || 0,
    totalRuntimeStates: runtimeStateCount?.c || 0,
  };
}

export const USER_DATA_EXPORT_SECTIONS = [
  "personas",
  "messages",
  "personaFiles",
  "personaSources",
  "personaSourceChunks",
  "memories",
  "emotionSnapshots",
  "diaryEntries",
  "roleplayChannels",
  "roleplayChannelMembers",
  "roleplayMessages",
  "wechatBindings",
  "skillJobs",
  "llmUsageRecords",
  "personaRuntimeStates",
  "llmConfigs",
  "wechatBotState",
  "scenes",
] as const;

export type UserDataExportRows = {
  user?: Record<string, unknown> | null;
  personas?: unknown[];
  messages?: unknown[];
  personaFiles?: unknown[];
  personaSources?: unknown[];
  personaSourceChunks?: unknown[];
  memories?: unknown[];
  emotionSnapshots?: unknown[];
  diaryEntries?: unknown[];
  roleplayChannels?: unknown[];
  roleplayChannelMembers?: unknown[];
  roleplayMessages?: unknown[];
  wechatBindings?: unknown[];
  skillJobs?: unknown[];
  llmUsageRecords?: unknown[];
  personaRuntimeStates?: unknown[];
  llmConfigs?: Array<Record<string, unknown>>;
  wechatBotState?: unknown[];
  scenes?: unknown[];
};

function omitPrivateKeys<T extends Record<string, unknown>>(row: T | null | undefined, keys: string[]) {
  if (!row) return row;
  const clone: Record<string, unknown> = { ...row };
  for (const key of keys) delete clone[key];
  return clone;
}

export function buildUserDataExportPayload(rows: UserDataExportRows) {
  return {
    exportedAt: new Date().toISOString(),
    schemaVersion: 2,
    notes: [
      "账户密码哈希和会话 Cookie 不会导出",
      "LLM 配置中的密钥值不会导出",
      "local uploads, TTS cache, NapCat state, and local database files are not embedded in this JSON export",
    ],
    user: omitPrivateKeys(rows.user, ["passwordHash"]),
    personas: rows.personas ?? [],
    messages: rows.messages ?? [],
    personaFiles: rows.personaFiles ?? [],
    personaSources: rows.personaSources ?? [],
    personaSourceChunks: rows.personaSourceChunks ?? [],
    memories: rows.memories ?? [],
    emotionSnapshots: rows.emotionSnapshots ?? [],
    diaryEntries: rows.diaryEntries ?? [],
    roleplayChannels: rows.roleplayChannels ?? [],
    roleplayChannelMembers: rows.roleplayChannelMembers ?? [],
    roleplayMessages: rows.roleplayMessages ?? [],
    wechatBindings: rows.wechatBindings ?? [],
    skillJobs: rows.skillJobs ?? [],
    llmUsageRecords: rows.llmUsageRecords ?? [],
    personaRuntimeStates: rows.personaRuntimeStates ?? [],
    llmConfigs: (rows.llmConfigs ?? []).map(config => omitPrivateKeys(config, ["apiKey"])),
    wechatBotState: rows.wechatBotState ?? [],
    scenes: rows.scenes ?? [],
  };
}

export async function exportUserData(userId: number) {
  const db = await getDb();
  if (!db) return null;
  await ensureRoleplayTables();
  await ensureLlmUsageTable();
  await ensurePersonaRuntimeStatesTable();
  const [user] = await db.select({
    username: users.username,
    name: users.name,
    email: users.email,
    loginMethod: users.loginMethod,
    role: users.role,
    createdAt: users.createdAt,
    updatedAt: users.updatedAt,
    lastSignedIn: users.lastSignedIn,
  })
    .from(users).where(eq(users.id, userId));
  const personaList = await db.select().from(personas).where(eq(personas.userId, userId));
  const messageList = await db.select().from(messages).where(eq(messages.userId, userId)).orderBy(messages.createdAt);
  const fileList = await db.select().from(personaFiles).where(eq(personaFiles.userId, userId)).orderBy(personaFiles.createdAt);
  const sourceList = await db.select().from(personaSources).where(eq(personaSources.userId, userId)).orderBy(personaSources.createdAt);
  const sourceChunkList = await db.select().from(personaSourceChunks).where(eq(personaSourceChunks.userId, userId)).orderBy(personaSourceChunks.createdAt);
  const memoryList = await db.select().from(memories).where(eq(memories.userId, userId)).orderBy(memories.createdAt);
  const emotionSnapshotList = await db.select().from(emotionSnapshots).where(eq(emotionSnapshots.userId, userId)).orderBy(emotionSnapshots.createdAt);
  const diaryEntryList = await db.select().from(diaryEntries).where(eq(diaryEntries.userId, userId)).orderBy(diaryEntries.createdAt);
  const roleplayChannelList = await db.select().from(roleplayChannels).where(eq(roleplayChannels.userId, userId)).orderBy(roleplayChannels.createdAt);
  const roleplayMemberList = await db.select().from(roleplayChannelMembers).where(eq(roleplayChannelMembers.userId, userId)).orderBy(roleplayChannelMembers.createdAt);
  const roleplayMessageList = await db.select().from(roleplayMessages).where(eq(roleplayMessages.userId, userId)).orderBy(roleplayMessages.createdAt);
  const wechatBindingList = await db.select().from(wechatBindings).where(eq(wechatBindings.userId, userId)).orderBy(wechatBindings.createdAt);
  const skillJobList = await db.select().from(skillJobs).where(eq(skillJobs.userId, userId)).orderBy(skillJobs.createdAt);
  const llmUsageRecordList = await db.select().from(llmUsageRecords).where(eq(llmUsageRecords.userId, userId)).orderBy(llmUsageRecords.startedAt);
  const personaRuntimeStateList = await db.select().from(personaRuntimeStates).where(eq(personaRuntimeStates.userId, userId)).orderBy(personaRuntimeStates.updatedAt);
  const llmConfigList = await db.select({
    id: llmConfigs.id,
    userId: llmConfigs.userId,
    providerName: llmConfigs.providerName,
    isDefault: llmConfigs.isDefault,
    baseUrl: llmConfigs.baseUrl,
    model: llmConfigs.model,
    systemMessage: llmConfigs.systemMessage,
    extraConfig: llmConfigs.extraConfig,
    createdAt: llmConfigs.createdAt,
  }).from(llmConfigs).where(eq(llmConfigs.userId, userId)).orderBy(llmConfigs.createdAt);
  const wechatBotStateList = await db.select().from(wechatBotState).where(eq(wechatBotState.userId, userId)).orderBy(wechatBotState.updatedAt);
  const sceneList = await db.select().from(scenes).where(eq(scenes.userId, userId)).orderBy(scenes.createdAt);
  return buildUserDataExportPayload({
    user,
    personas: personaList,
    messages: messageList,
    personaFiles: fileList,
    personaSources: sourceList,
    personaSourceChunks: sourceChunkList,
    memories: memoryList,
    emotionSnapshots: emotionSnapshotList,
    diaryEntries: diaryEntryList,
    roleplayChannels: roleplayChannelList,
    roleplayChannelMembers: roleplayMemberList,
    roleplayMessages: roleplayMessageList,
    wechatBindings: wechatBindingList,
    skillJobs: skillJobList,
    llmUsageRecords: llmUsageRecordList,
    personaRuntimeStates: personaRuntimeStateList,
    llmConfigs: llmConfigList,
    wechatBotState: wechatBotStateList,
    scenes: sceneList,
  });
}

// ─── Persona helpers ────────────────────────────────────────────────────────

export async function createPersona(data: InsertPersona) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(personas).values(data).returning({ id: personas.id });
  return result.id;
}

export async function getPersonasByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  const list = await db.select().from(personas).where(eq(personas.userId, userId)).orderBy(desc(personas.updatedAt));
  return mergePersonaRuntimeRows(list);
}

export async function getReadyPersonasForProactiveMessages() {
  const db = await getDb();
  if (!db) return [];

  const list = await db
    .select()
    .from(personas)
    .where(eq(personas.analysisStatus, "ready"))
    .orderBy(asc(personas.id));
  const hydratedList = await mergePersonaRuntimeRows(list);

  return hydratedList.filter((p) => {
    const proactive = getProactiveMessageConfig(p.personaData);
    return Boolean(proactive?.enabled && Array.isArray(proactive.times) && proactive.times.length > 0);
  });
}

export async function getReadyPersonasForDailyMemory() {
  const db = await getDb();
  if (!db) return [];

  const list = await db
    .select()
    .from(personas)
    .where(eq(personas.analysisStatus, "ready"))
    .orderBy(asc(personas.id));
  return mergePersonaRuntimeRows(list);
}

export async function getPersonasWithStats(userId: number) {
  const db = await getDb();
  if (!db) return [];
  const rawList = await db.select().from(personas).where(eq(personas.userId, userId)).orderBy(desc(personas.updatedAt));
  const list = await mergePersonaRuntimeRows(rawList);
  const result = [];
  for (const p of list) {
    const [lastMsgRow] = await db.select({ content: messages.content, createdAt: messages.createdAt })
      .from(messages).where(eq(messages.personaId, p.id)).orderBy(desc(messages.createdAt)).limit(1);
    const [fileCountRow] = await db.select({ c: count() }).from(personaFiles).where(eq(personaFiles.personaId, p.id));
    const [bindingRow] = await db.select({ c: count() }).from(wechatBindings)
      .where(and(eq(wechatBindings.personaId, p.id), eq(wechatBindings.isActive, true), nonQqBindingFilter()));
    result.push({
      ...p,
      lastMessage: lastMsgRow ? { content: (lastMsgRow.content || "").slice(0, 60), createdAt: lastMsgRow.createdAt } : null,
      fileCount: fileCountRow?.c || 0,
      wechatBound: (bindingRow?.c || 0) > 0,
    });
  }
  return result;
}

export async function getUserStats(userId: number) {
  const db = await getDb();
  if (!db) return { totalPersonas: 0, totalChats: 0, todayChats: 0, memberSince: new Date() };
  const [personaCount] = await db.select({ c: count() }).from(personas).where(eq(personas.userId, userId));
  const [chatSum] = await db.select({ s: sum(personas.chatCount) }).from(personas).where(eq(personas.userId, userId));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const [todayCount] = await db.select({ c: count() }).from(messages)
    .where(and(eq(messages.userId, userId), gte(messages.createdAt, today)));
  const [userRow] = await db.select({ createdAt: users.createdAt }).from(users).where(eq(users.id, userId));
  return {
    totalPersonas: personaCount?.c || 0,
    totalChats: Number(chatSum?.s) || 0,
    todayChats: todayCount?.c || 0,
    memberSince: userRow?.createdAt || new Date(),
  };
}

export async function getRecentActivity(userId: number, limit = 8) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({
    id: messages.id,
    personaId: messages.personaId,
    role: messages.role,
    content: messages.content,
    createdAt: messages.createdAt,
    personaName: personas.name,
    emotionalState: personas.emotionalState,
  })
    .from(messages)
    .innerJoin(personas, eq(messages.personaId, personas.id))
    .where(eq(messages.userId, userId))
    .orderBy(desc(messages.createdAt))
    .limit(limit);
  return rows.map(r => ({
    ...r,
    content: (r.content || "").slice(0, 80),
  }));
}

export async function getPersonaById(id: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  // personas LEFT JOIN personaRuntimeStates 一条查询取回主行 + 运行时态，替代原「先查 personas 再单独查 runtime」两条 SQL。
  // 每条入站消息热路径会多次读 persona（bridge resolveSceneOverlay + 主回合等），合并后单次读减半往返。
  await ensurePersonaRuntimeStatesTable();
  const [joined] = await db.select().from(personas)
    .leftJoin(personaRuntimeStates, and(
      eq(personaRuntimeStates.personaId, personas.id),
      eq(personaRuntimeStates.userId, personas.userId),
    ))
    .where(and(eq(personas.id, id), eq(personas.userId, userId))).limit(1);
  if (!joined) return undefined;
  return mergePersonaRuntimeRow(joined.personas, joined.persona_runtime_states ?? undefined);
}

export async function updatePersona(id: number, userId: number, data: Partial<InsertPersona>) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  let runtimeUpdate: ReturnType<typeof extractPersonaRuntimeForStorage> | null = null;
  const nextData: Partial<InsertPersona> = { ...data };
  if ("personaData" in nextData) {
    runtimeUpdate = extractPersonaRuntimeForStorage(nextData.personaData);
    nextData.personaData = runtimeUpdate.personaData;
  }
  await db.update(personas).set(nextData).where(and(eq(personas.id, id), eq(personas.userId, userId)));
  if (runtimeUpdate?.hasRuntimePatch) {
    await upsertPersonaRuntimeState(id, userId, runtimeUpdate);
  }
}

type DbClient = NonNullable<Awaited<ReturnType<typeof getDb>>>;

async function deactivateRoleplayChannelsWithTooFewMembers(
  database: DbClient,
  userId: number,
  channelIds: number[],
) {
  const uniqueChannelIds = Array.from(new Set(channelIds)).filter(Number.isFinite);
  if (uniqueChannelIds.length === 0) return;

  const memberCounts = await database.select({
    channelId: roleplayChannelMembers.channelId,
    memberCount: count(),
  })
    .from(roleplayChannelMembers)
    .where(and(
      eq(roleplayChannelMembers.userId, userId),
      inArray(roleplayChannelMembers.channelId, uniqueChannelIds),
    ))
    .groupBy(roleplayChannelMembers.channelId);

  const countsByChannel = new Map(memberCounts.map(row => [row.channelId, row.memberCount]));
  const inactiveChannelIds = uniqueChannelIds.filter(channelId => (
    shouldDeactivateRoleplayChannelAfterMemberRemoval(countsByChannel.get(channelId) ?? 0)
  ));
  if (inactiveChannelIds.length === 0) return;

  await database.update(roleplayChannels)
    .set({ isActive: false, updatedAt: new Date() })
    .where(and(
      eq(roleplayChannels.userId, userId),
      inArray(roleplayChannels.id, inactiveChannelIds),
    ));
}

export async function deletePersona(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await ensureRoleplayTables();
  await ensurePersonaRuntimeStatesTable();
  const affectedRoleplayChannels = await db.select({ channelId: roleplayChannelMembers.channelId })
    .from(roleplayChannelMembers)
    .where(and(eq(roleplayChannelMembers.personaId, id), eq(roleplayChannelMembers.userId, userId)));
  const affectedRoleplayChannelIds = affectedRoleplayChannels.map(row => row.channelId);
  await db.delete(memories).where(eq(memories.personaId, id));
  await db.delete(emotionSnapshots).where(eq(emotionSnapshots.personaId, id));
  await db.delete(diaryEntries).where(and(eq(diaryEntries.personaId, id), eq(diaryEntries.userId, userId)));
  await db.delete(personaRuntimeStates).where(and(eq(personaRuntimeStates.personaId, id), eq(personaRuntimeStates.userId, userId)));
  await db.delete(roleplayMessages).where(and(eq(roleplayMessages.personaId, id), eq(roleplayMessages.userId, userId)));
  await db.delete(roleplayChannelMembers).where(and(eq(roleplayChannelMembers.personaId, id), eq(roleplayChannelMembers.userId, userId)));
  await deactivateRoleplayChannelsWithTooFewMembers(db, userId, affectedRoleplayChannelIds);
  await db.delete(messages).where(eq(messages.personaId, id));
  await db.delete(personaFiles).where(eq(personaFiles.personaId, id));
  await db.delete(personaSourceChunks).where(eq(personaSourceChunks.personaId, id));
  await db.delete(personaSources).where(eq(personaSources.personaId, id));
  await db.delete(wechatBindings).where(eq(wechatBindings.personaId, id));
  await db.delete(skillJobs).where(eq(skillJobs.personaId, id));
  await db.delete(personas).where(and(eq(personas.id, id), eq(personas.userId, userId)));
}

// ─── PersonaFile helpers ────────────────────────────────────────────────────

export async function createPersonaFile(data: InsertPersonaFile) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(personaFiles).values(data).returning({ id: personaFiles.id });
  return result.id;
}

export async function getFilesByPersonaId(personaId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(personaFiles).where(eq(personaFiles.personaId, personaId)).orderBy(desc(personaFiles.createdAt));
}

// ─── Persona source library helpers ────────────────────────────────────────

export type PersonaSourceRecallChunk = {
  id: number;
  sourceId: number;
  sourceTitle: string;
  chapterTitle: string | null;
  chunkIndex: number;
  content: string;
  score: number;
  matchedTerms?: string[];
  seedRank?: number;
  distanceFromSeed?: number;
};

export type PersonaSourceLibraryOverview = {
  stats: {
    sourceCount: number;
    chunkCount: number;
    chapterCount: number;
    tokenEstimate: number;
  };
  topKeywords: string[];
  sources: Array<{
    id: number;
    title: string;
    sourceType: string;
    originalName: string | null;
    createdAt: Date;
    updatedAt: Date;
    chunkCount: number;
    chapterCount: number;
    tokenEstimate: number;
    topKeywords: string[];
    chapters: Array<{
      title: string;
      chunkCount: number;
      tokenEstimate: number;
    }>;
  }>;
  search: {
    query: string;
    results: PersonaSourceRecallChunk[];
  };
};

let personaSourceTablesEnsured = false;

export async function ensurePersonaSourceTables() {
  if (personaSourceTablesEnsured) return;
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "persona_sources" (
      "id" serial PRIMARY KEY NOT NULL,
      "personaId" integer NOT NULL,
      "userId" integer NOT NULL,
      "title" varchar(255) NOT NULL,
      "sourceType" varchar(50) DEFAULT 'epub' NOT NULL,
      "originalName" varchar(255),
      "fileHash" varchar(128),
      "metadata" jsonb,
      "createdAt" timestamp DEFAULT now() NOT NULL,
      "updatedAt" timestamp DEFAULT now() NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "persona_source_chunks" (
      "id" serial PRIMARY KEY NOT NULL,
      "sourceId" integer NOT NULL,
      "personaId" integer NOT NULL,
      "userId" integer NOT NULL,
      "chapterTitle" text,
      "chunkIndex" integer NOT NULL,
      "content" text NOT NULL,
      "keywords" jsonb,
      "tokenEstimate" integer,
      "createdAt" timestamp DEFAULT now() NOT NULL
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "persona_sources_persona_user_idx" ON "persona_sources" ("personaId", "userId")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "persona_source_chunks_persona_user_idx" ON "persona_source_chunks" ("personaId", "userId")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "persona_source_chunks_source_idx" ON "persona_source_chunks" ("sourceId")`);

  personaSourceTablesEnsured = true;
}

export async function createPersonaSource(data: InsertPersonaSource) {
  await ensurePersonaSourceTables();
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(personaSources).values(data).returning({ id: personaSources.id });
  return result.id;
}

export async function createPersonaSourceChunks(chunks: InsertPersonaSourceChunk[]) {
  if (chunks.length === 0) return;
  await ensurePersonaSourceTables();
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.insert(personaSourceChunks).values(chunks);
}

export async function deletePersonaSourcesByOriginalName(personaId: number, userId: number, originalName: string) {
  await ensurePersonaSourceTables();
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const existing = await db.select({ id: personaSources.id })
    .from(personaSources)
    .where(and(
      eq(personaSources.personaId, personaId),
      eq(personaSources.userId, userId),
      eq(personaSources.originalName, originalName),
    ));
  const ids = existing.map(row => row.id);
  if (ids.length === 0) return;

  await db.delete(personaSourceChunks).where(sql`${personaSourceChunks.sourceId} = ANY(${ids})`);
  await db.delete(personaSources).where(sql`${personaSources.id} = ANY(${ids})`);
}

const SOURCE_STOP_WORDS = new Set([
  "你", "我", "他", "她", "它", "我们", "你们", "他们", "这个", "那个", "什么", "怎么", "为什么",
  "是不是", "有没有", "哪里", "哪儿", "记得", "还记得", "想起", "回忆", "原著", "小说", "里面", "内容", "时候",
  "的时候", "当年", "以前", "后来", "现在", "一下", "一点", "那个时候", "那时候", "那会儿",
  "你还", "那你", "还记", "那次", "这次", "次吗", "了吗", "的吗", "什么时", "么时候",
  "就是", "明明", "根本", "不对", "不是", "这样", "真的",
]);

const COMMON_SOURCE_TERMS = new Set(DEFAULT_SOURCE_TERMS);

function isNoisySourceTerm(term: string): boolean {
  if (SOURCE_STOP_WORDS.has(term)) return true;
  if (/^[吗呢啊吧呀嘛哦嗯的了过着和与及又还再就都很更挺真]$/.test(term)) return true;
  if (/^(你|我|他|她|我们|你们|他们|那你).{1,2}$/.test(term) && !COMMON_SOURCE_TERMS.has(term)) return true;
  if (/^(还记|记得|得不|不记|知道|觉得|问一|说一)/.test(term)) return true;
  if (/(了吗|的吗|的事|这事|那事|这件|那件)$/.test(term)) return true;
  return false;
}

function addTerm(terms: string[], seen: Set<string>, value: string) {
  const term = value.trim();
  if (term.length < 2 || isNoisySourceTerm(term)) return;
  const normalized = term.slice(0, 32);
  if (seen.has(normalized)) return;
  seen.add(normalized);
  terms.push(normalized);
}

export function extractPersonaSourceSearchTerms(query: string): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();

  const expansions: Array<[RegExp, string[]]> = [
    [/第一次|初遇|遇见|见面|见到/, ["第一次", "第一次走进", "王老师", "院子", "遇见", "西北", "湾子村"]],
    [/老鹰峡|救|危险|向导|狼/, ["老鹰峡", "向导", "狼", "救", "危险"]],
    [/跑出来|没回去|不在|找我|找你|闹翻|逃避|躲|躲着/, ["家人闹翻", "逃避", "不在这里", "找不到", "山洞", "老鹰峡", "小狼"]],
    [/山洞|崖洞|洞里|洞口/, ["山洞", "洞口", "石壁", "释迦牟尼"]],
    [/湖里|湖边|湖中|湖水|水里|洗澡|踢到|踢坏|私密/, ["湖边", "湖水", "洗澡", "水中", "私密处", "踢坏", "幸亏是在水里"]],
    [/北京|治疗|左臂|手臂|胳膊/, ["北京", "治疗", "左臂", "林慧珍", "手术"]],
    [/南京|读书|进城|城市/, ["南京", "读书", "进城"]],
    [/中考|考场|考试|学校|大热天/, ["中考", "考场", "考试", "学校", "大热天"]],
    [/睡在一起|睡一块|抱着|抱|搂/, ["睡", "一块", "抱着", "搂", "床"]],
    [/表白|亲吻|亲|吻|爱|喜欢/, ["表白", "亲吻", "喜欢", "爱"]],
    [/车祸|轮椅|身体/, ["车祸", "身体", "健康"]],
    [/小川|儿子/, ["小川", "儿子"]],
    [/姚敏|婚姻|妻子/, ["姚敏", "婚姻"]],
    [/林慧珍|旧识/, ["林慧珍"]],
    [/老赵|小刘|大刘|小彭|研究所|地质/, ["老赵", "小刘", "大刘", "小彭", "研究所", "地质"]],
    [/柱子|玉柱|敏子/, ["柱子", "王玉柱", "敏子"]],
  ];
  for (const [pattern, values] of expansions) {
    if (pattern.test(query)) values.forEach(value => addTerm(terms, seen, value));
  }

  const normalized = query.replace(/[^\u4e00-\u9fffA-Za-z0-9]+/g, " ");
  for (const token of normalized.split(/\s+/).filter(Boolean)) {
    if (/^[A-Za-z0-9]+$/.test(token)) {
      addTerm(terms, seen, token);
      continue;
    }
    const chars = Array.from(token);
    if (chars.length <= 8) addTerm(terms, seen, token);
    for (const size of [4, 3, 2]) {
      if (chars.length < size) continue;
      for (let i = 0; i <= chars.length - size; i += 1) {
        addTerm(terms, seen, chars.slice(i, i + size).join(""));
      }
    }
  }

  return terms.slice(0, 24);
}

function occurrenceCount(text: string, term: string): number {
  if (!term) return 0;
  let count = 0;
  let index = text.indexOf(term);
  while (index >= 0) {
    count += 1;
    index = text.indexOf(term, index + term.length);
  }
  return count;
}

const IMPORTANT_SOURCE_TERMS = new Set([
  "老鹰峡", "向导", "狼", "山洞", "洞口", "石壁", "家人闹翻", "逃避", "不在这里", "小狼",
  "湖边", "湖水", "洗澡", "水中", "私密处", "踢坏", "幸亏是在水里",
  "左臂", "北京", "治疗", "林慧珍", "手术",
  "第一次走进", "第一次", "王老师", "院子", "车祸", "表白", "亲吻",
  "姚敏", "小川", "研究所", "地质", "中考", "考场", "考试", "学校", "抱着",
]);

function sourceTermWeight(term: string): number {
  if (COMMON_SOURCE_TERMS.has(term)) return 1;
  if (IMPORTANT_SOURCE_TERMS.has(term)) return term.length + 12;
  if (term.length >= 5) return term.length + 8;
  if (term.length >= 3) return term.length + 3;
  return term.length + 1;
}

function scoreSourceChunk(row: { content: string; chapterTitle: string | null }, terms: string[]): number {
  const content = row.content || "";
  const chapter = row.chapterTitle || "";
  let score = 0;
  for (const term of terms) {
    const weight = sourceTermWeight(term);
    const contentHits = Math.min(occurrenceCount(content, term), COMMON_SOURCE_TERMS.has(term) ? 2 : 5);
    const chapterHits = Math.min(occurrenceCount(chapter, term), 2);
    if (contentHits > 0) score += contentHits * weight;
    if (chapterHits > 0) score += chapterHits * (weight + 8);
  }
  return score;
}

function matchedSourceTerms(row: { content: string; chapterTitle: string | null }, terms: string[]): string[] {
  const content = row.content || "";
  const chapter = row.chapterTitle || "";
  const matched = terms.filter(term => content.includes(term) || chapter.includes(term));
  return matched.filter((term) => {
    return !matched.some(other => other !== term && other.length > term.length && other.includes(term));
  });
}

export async function searchPersonaSourceChunks(
  personaId: number,
  userId: number,
  query: string,
  limit = 6,
): Promise<PersonaSourceRecallChunk[]> {
  await ensurePersonaSourceTables();
  const db = await getDb();
  if (!db) return [];

  const terms = extractPersonaSourceSearchTerms(query);
  if (terms.length === 0) return [];

  const conditions = terms.flatMap(term => {
    const pattern = `%${term}%`;
    return [
      sql`${personaSourceChunks.content} ILIKE ${pattern}`,
      sql`${personaSourceChunks.chapterTitle} ILIKE ${pattern}`,
    ];
  });

  const rows = await db.select({
    id: personaSourceChunks.id,
    sourceId: personaSourceChunks.sourceId,
    sourceTitle: personaSources.title,
    chapterTitle: personaSourceChunks.chapterTitle,
    chunkIndex: personaSourceChunks.chunkIndex,
    content: personaSourceChunks.content,
  })
    .from(personaSourceChunks)
    .innerJoin(personaSources, eq(personaSourceChunks.sourceId, personaSources.id))
    .where(and(
      eq(personaSourceChunks.personaId, personaId),
      eq(personaSourceChunks.userId, userId),
      sql`(${sql.join(conditions, sql` OR `)})`,
    ))
    .limit(1200);

  const scoredRows = rows
    .map(row => ({
      ...row,
      matchedTerms: matchedSourceTerms(row, terms),
      score: scoreSourceChunk(row, terms),
    }))
    .filter(row => row.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scoredRows.length === 0) return [];

  const seedRows = scoredRows.slice(0, Math.max(3, Math.min(scoredRows.length, limit)));
  const neighborConditions = seedRows.map(seed => sql`(
    ${personaSourceChunks.sourceId} = ${seed.sourceId}
    AND ${personaSourceChunks.chunkIndex} BETWEEN ${Math.max(0, seed.chunkIndex - 1)} AND ${seed.chunkIndex + 1}
  )`);

  const neighborRows = await db.select({
    id: personaSourceChunks.id,
    sourceId: personaSourceChunks.sourceId,
    sourceTitle: personaSources.title,
    chapterTitle: personaSourceChunks.chapterTitle,
    chunkIndex: personaSourceChunks.chunkIndex,
    content: personaSourceChunks.content,
  })
    .from(personaSourceChunks)
    .innerJoin(personaSources, eq(personaSourceChunks.sourceId, personaSources.id))
    .where(and(
      eq(personaSourceChunks.personaId, personaId),
      eq(personaSourceChunks.userId, userId),
      sql`(${sql.join(neighborConditions, sql` OR `)})`,
    ))
    .limit(seedRows.length * 3 + 3);

  const bestById = new Map<number, PersonaSourceRecallChunk>();
  for (const row of neighborRows) {
    let bestSeed: (typeof seedRows)[number] | undefined;
    let bestSeedRank = Number.POSITIVE_INFINITY;
    let bestDistance = Number.POSITIVE_INFINITY;

    seedRows.forEach((seed, index) => {
      if (seed.sourceId !== row.sourceId) return;
      const distance = Math.abs(seed.chunkIndex - row.chunkIndex);
      if (distance > 1) return;
      if (index < bestSeedRank || (index === bestSeedRank && distance < bestDistance)) {
        bestSeed = seed;
        bestSeedRank = index;
        bestDistance = distance;
      }
    });

    if (!bestSeed) continue;
    const matchedTerms = matchedSourceTerms(row, terms);
    const score = Math.max(
      scoreSourceChunk(row, terms),
      bestSeed.score - bestDistance * 4,
    );
    const existing = bestById.get(row.id);
    if (!existing || score > existing.score) {
      bestById.set(row.id, {
        ...row,
        matchedTerms,
        score,
        seedRank: bestSeedRank,
        distanceFromSeed: bestDistance,
      });
    }
  }

  return Array.from(bestById.values())
    .sort((a, b) => {
      const rankDiff = (a.seedRank ?? 0) - (b.seedRank ?? 0);
      if (rankDiff !== 0) return rankDiff;
      if (a.sourceId !== b.sourceId) return a.sourceId - b.sourceId;
      return a.chunkIndex - b.chunkIndex;
    })
    .slice(0, limit);
}

export async function getPersonaSourceLibraryStats(personaId: number, userId: number) {
  await ensurePersonaSourceTables();
  const db = await getDb();
  if (!db) return { sourceCount: 0, chunkCount: 0 };
  const [sourceCount] = await db.select({ c: count() }).from(personaSources)
    .where(and(eq(personaSources.personaId, personaId), eq(personaSources.userId, userId)));
  const [chunkCount] = await db.select({ c: count() }).from(personaSourceChunks)
    .where(and(eq(personaSourceChunks.personaId, personaId), eq(personaSourceChunks.userId, userId)));
  return { sourceCount: sourceCount?.c || 0, chunkCount: chunkCount?.c || 0 };
}

function toCount(value: unknown): number {
  const parsed = typeof value === "bigint"
    ? Number(value)
    : typeof value === "number"
      ? value
      : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizedSourceKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const keyword = String(item ?? "").trim();
    if (!keyword || keyword.length > 32 || seen.has(keyword)) continue;
    seen.add(keyword);
    result.push(keyword);
  }
  return result;
}

function topSourceKeywords(values: unknown[], limit = 8): string[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    for (const keyword of normalizedSourceKeywords(value)) {
      counts.set(keyword, (counts.get(keyword) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"))
    .slice(0, limit)
    .map(([keyword]) => keyword);
}

export async function getPersonaSourceLibraryOverview(
  personaId: number,
  userId: number,
  query = "",
): Promise<PersonaSourceLibraryOverview> {
  await ensurePersonaSourceTables();
  const db = await getDb();
  const empty: PersonaSourceLibraryOverview = {
    stats: { sourceCount: 0, chunkCount: 0, chapterCount: 0, tokenEstimate: 0 },
    topKeywords: [],
    sources: [],
    search: { query: query.trim(), results: [] },
  };
  if (!db) return empty;

  const sourceRows = await db.select().from(personaSources)
    .where(and(eq(personaSources.personaId, personaId), eq(personaSources.userId, userId)))
    .orderBy(desc(personaSources.updatedAt));

  if (sourceRows.length === 0) return empty;

  const statRows = await db.select({
    sourceId: personaSourceChunks.sourceId,
    chunkCount: sql<number>`count(*)::int`,
    chapterCount: sql<number>`count(distinct coalesce(${personaSourceChunks.chapterTitle}, ''))::int`,
    tokenEstimate: sql<number>`coalesce(sum(${personaSourceChunks.tokenEstimate}), 0)::int`,
  })
    .from(personaSourceChunks)
    .where(and(eq(personaSourceChunks.personaId, personaId), eq(personaSourceChunks.userId, userId)))
    .groupBy(personaSourceChunks.sourceId);

  const chapterRows = await db.select({
    sourceId: personaSourceChunks.sourceId,
    chapterTitle: personaSourceChunks.chapterTitle,
    chunkCount: sql<number>`count(*)::int`,
    tokenEstimate: sql<number>`coalesce(sum(${personaSourceChunks.tokenEstimate}), 0)::int`,
    firstChunkIndex: sql<number>`min(${personaSourceChunks.chunkIndex})::int`,
  })
    .from(personaSourceChunks)
    .where(and(eq(personaSourceChunks.personaId, personaId), eq(personaSourceChunks.userId, userId)))
    .groupBy(personaSourceChunks.sourceId, personaSourceChunks.chapterTitle)
    .orderBy(personaSourceChunks.sourceId, sql`min(${personaSourceChunks.chunkIndex})`);

  const keywordRows = await db.select({
    sourceId: personaSourceChunks.sourceId,
    keywords: personaSourceChunks.keywords,
  })
    .from(personaSourceChunks)
    .where(and(eq(personaSourceChunks.personaId, personaId), eq(personaSourceChunks.userId, userId)))
    .limit(2000);

  const statsBySource = new Map(statRows.map(row => [row.sourceId, {
    chunkCount: toCount(row.chunkCount),
    chapterCount: toCount(row.chapterCount),
    tokenEstimate: toCount(row.tokenEstimate),
  }]));

  const chaptersBySource = new Map<number, PersonaSourceLibraryOverview["sources"][number]["chapters"]>();
  for (const row of chapterRows) {
    const chapterList = chaptersBySource.get(row.sourceId) ?? [];
    if (chapterList.length < 8) {
      chapterList.push({
        title: row.chapterTitle?.trim() || "未分章",
        chunkCount: toCount(row.chunkCount),
        tokenEstimate: toCount(row.tokenEstimate),
      });
    }
    chaptersBySource.set(row.sourceId, chapterList);
  }

  const keywordsBySource = new Map<number, unknown[]>();
  for (const row of keywordRows) {
    const values = keywordsBySource.get(row.sourceId) ?? [];
    values.push(row.keywords);
    keywordsBySource.set(row.sourceId, values);
  }

  const totalChapterTitles = new Set<string>();
  for (const row of chapterRows) {
    totalChapterTitles.add(`${row.sourceId}:${row.chapterTitle?.trim() || "未分章"}`);
  }

  const sources = sourceRows.map(source => {
    const stats = statsBySource.get(source.id) ?? { chunkCount: 0, chapterCount: 0, tokenEstimate: 0 };
    return {
      id: source.id,
      title: source.title,
      sourceType: source.sourceType,
      originalName: source.originalName,
      createdAt: source.createdAt,
      updatedAt: source.updatedAt,
      ...stats,
      topKeywords: topSourceKeywords(keywordsBySource.get(source.id) ?? [], 6),
      chapters: chaptersBySource.get(source.id) ?? [],
    };
  });

  const trimmedQuery = query.trim().slice(0, 120);
  const results = trimmedQuery
    ? await searchPersonaSourceChunks(personaId, userId, trimmedQuery, 8)
    : [];

  return {
    stats: {
      sourceCount: sourceRows.length,
      chunkCount: sources.reduce((sum, source) => sum + source.chunkCount, 0),
      chapterCount: totalChapterTitles.size,
      tokenEstimate: sources.reduce((sum, source) => sum + source.tokenEstimate, 0),
    },
    topKeywords: topSourceKeywords(keywordRows.map(row => row.keywords), 12),
    sources,
    search: { query: trimmedQuery, results },
  };
}

// ─── Message helpers ────────────────────────────────────────────────────────

export async function createMessage(data: InsertMessage) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(messages).values(data).returning({ id: messages.id });
  return result.id;
}

export async function getMessagesByPersonaId(personaId: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(messages)
    .where(eq(messages.personaId, personaId)).orderBy(desc(messages.createdAt)).limit(limit);
  return rows.reverse();
}

export async function clearMessagesByPersonaId(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(messages).where(and(eq(messages.personaId, personaId), eq(messages.userId, userId)));
}

export async function deleteMessage(id: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(messages).where(and(eq(messages.id, id), eq(messages.userId, userId)));
}

export async function searchMessages(personaId: number, userId: number, query: string, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(messages)
    .where(and(eq(messages.personaId, personaId), eq(messages.userId, userId), ilike(messages.content, `%${query}%`)))
    .orderBy(desc(messages.createdAt))
    .limit(limit);
}

// ─── Roleplay channel helpers ───────────────────────────────────────────────

let roleplayTablesEnsured = false;

export type RoleplayChannelMemberView = {
  id: number;
  channelId: number;
  personaId: number;
  displayOrder: number;
  speakingEnabled: boolean;
  lastReadMessageId: number;
  personaName: string;
  avatarUrl: string | null;
  emotionalState: string;
  analysisStatus: string;
};

export type RoleplayChannelView = {
  id: number;
  userId: number;
  name: string;
  description: string | null;
  scenePrompt: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  members: RoleplayChannelMemberView[];
};

export async function ensureRoleplayTables() {
  if (roleplayTablesEnsured) return;
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "roleplay_channels" (
      "id" serial PRIMARY KEY NOT NULL,
      "userId" integer NOT NULL,
      "name" varchar(100) NOT NULL,
      "description" text,
      "scenePrompt" text,
      "isActive" boolean DEFAULT true NOT NULL,
      "createdAt" timestamp DEFAULT now() NOT NULL,
      "updatedAt" timestamp DEFAULT now() NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "roleplay_channel_members" (
      "id" serial PRIMARY KEY NOT NULL,
      "channelId" integer NOT NULL,
      "userId" integer NOT NULL,
      "personaId" integer NOT NULL,
      "displayOrder" integer DEFAULT 0 NOT NULL,
      "speakingEnabled" boolean DEFAULT true NOT NULL,
      "lastReadMessageId" integer DEFAULT 0 NOT NULL,
      "createdAt" timestamp DEFAULT now() NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "roleplay_messages" (
      "id" serial PRIMARY KEY NOT NULL,
      "channelId" integer NOT NULL,
      "userId" integer NOT NULL,
      "personaId" integer,
      "speakerName" varchar(100) NOT NULL,
      "role" varchar(32) DEFAULT 'persona' NOT NULL,
      "content" text NOT NULL,
      "innerThought" text,
      "moodState" jsonb,
      "turnKind" varchar(50) DEFAULT 'dialogue' NOT NULL,
      "createdAt" timestamp DEFAULT now() NOT NULL
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "roleplay_channels_user_idx" ON "roleplay_channels" ("userId")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "roleplay_members_channel_idx" ON "roleplay_channel_members" ("channelId", "displayOrder")`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "roleplay_members_channel_persona_idx" ON "roleplay_channel_members" ("channelId", "personaId")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "roleplay_messages_channel_idx" ON "roleplay_messages" ("channelId", "id")`);

  roleplayTablesEnsured = true;
}

export async function createRoleplayChannel(data: InsertRoleplayChannel, memberPersonaIds: number[]) {
  await ensureRoleplayTables();
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const uniquePersonaIds = Array.from(new Set(memberPersonaIds));
  if (uniquePersonaIds.length < 2) throw new Error("roleplay channel requires at least two personas");

  const [channel] = await db.insert(roleplayChannels).values(data).returning();
  const memberRows: InsertRoleplayChannelMember[] = uniquePersonaIds.map((personaId, index) => ({
    channelId: channel.id,
    userId: data.userId,
    personaId,
    displayOrder: index,
  }));
  await db.insert(roleplayChannelMembers).values(memberRows);
  return channel.id;
}

export async function getRoleplayChannels(userId: number): Promise<RoleplayChannelView[]> {
  await ensureRoleplayTables();
  const db = await getDb();
  if (!db) return [];
  const channels = await db.select().from(roleplayChannels)
    .where(eq(roleplayChannels.userId, userId))
    .orderBy(desc(roleplayChannels.updatedAt));

  const result: RoleplayChannelView[] = [];
  for (const channel of channels) {
    result.push({
      ...channel,
      members: await getRoleplayChannelMembers(channel.id, userId),
    });
  }
  return result;
}

export async function getRoleplayChannelById(channelId: number, userId: number): Promise<RoleplayChannelView | undefined> {
  await ensureRoleplayTables();
  const db = await getDb();
  if (!db) return undefined;
  const [channel] = await db.select().from(roleplayChannels)
    .where(and(eq(roleplayChannels.id, channelId), eq(roleplayChannels.userId, userId)))
    .limit(1);
  if (!channel) return undefined;
  return {
    ...channel,
    members: await getRoleplayChannelMembers(channelId, userId),
  };
}

export async function getRoleplayChannelMembers(channelId: number, userId: number): Promise<RoleplayChannelMemberView[]> {
  await ensureRoleplayTables();
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: roleplayChannelMembers.id,
    channelId: roleplayChannelMembers.channelId,
    personaId: roleplayChannelMembers.personaId,
    displayOrder: roleplayChannelMembers.displayOrder,
    speakingEnabled: roleplayChannelMembers.speakingEnabled,
    lastReadMessageId: roleplayChannelMembers.lastReadMessageId,
    personaName: personas.name,
    avatarUrl: personas.avatarUrl,
    emotionalState: personas.emotionalState,
    analysisStatus: personas.analysisStatus,
  })
    .from(roleplayChannelMembers)
    .innerJoin(personas, eq(roleplayChannelMembers.personaId, personas.id))
    .where(and(
      eq(roleplayChannelMembers.channelId, channelId),
      eq(roleplayChannelMembers.userId, userId),
      eq(personas.userId, userId),
    ))
    .orderBy(asc(roleplayChannelMembers.displayOrder), asc(roleplayChannelMembers.id));
}

export async function getRoleplayChannelMessages(channelId: number, userId: number, limit = 80) {
  await ensureRoleplayTables();
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(roleplayMessages)
    .where(and(eq(roleplayMessages.channelId, channelId), eq(roleplayMessages.userId, userId)))
    .orderBy(desc(roleplayMessages.id))
    .limit(limit);
  return rows.reverse();
}

export async function createRoleplayMessage(data: InsertRoleplayMessage) {
  await ensureRoleplayTables();
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(roleplayMessages).values(data).returning();
  await db.update(roleplayChannels)
    .set({ updatedAt: new Date() })
    .where(and(eq(roleplayChannels.id, data.channelId), eq(roleplayChannels.userId, data.userId)));
  return result;
}

export async function updateRoleplayMemberCursor(channelId: number, userId: number, personaId: number, lastReadMessageId: number) {
  await ensureRoleplayTables();
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(roleplayChannelMembers)
    .set({ lastReadMessageId })
    .where(and(
      eq(roleplayChannelMembers.channelId, channelId),
      eq(roleplayChannelMembers.userId, userId),
      eq(roleplayChannelMembers.personaId, personaId),
    ));
}

export async function deleteRoleplayChannel(channelId: number, userId: number) {
  await ensureRoleplayTables();
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(roleplayMessages).where(and(eq(roleplayMessages.channelId, channelId), eq(roleplayMessages.userId, userId)));
  await db.delete(roleplayChannelMembers).where(and(eq(roleplayChannelMembers.channelId, channelId), eq(roleplayChannelMembers.userId, userId)));
  await db.delete(roleplayChannels).where(and(eq(roleplayChannels.id, channelId), eq(roleplayChannels.userId, userId)));
}

// ─── WeChat Binding helpers ─────────────────────────────────────────────────

export const QQ_CONTACT_PREFIX = "qq:";

function isQqContactId(contactId: string | null | undefined): boolean {
  return Boolean(contactId?.startsWith(QQ_CONTACT_PREFIX));
}

function qqBindingFilter() {
  return sql`${wechatBindings.wechatContactId} LIKE ${`${QQ_CONTACT_PREFIX}%`}`;
}

function nonQqBindingFilter() {
  return sql`${wechatBindings.wechatContactId} NOT LIKE ${`${QQ_CONTACT_PREFIX}%`}`;
}

function normalizeQqContactId(contactId: string): string {
  const trimmed = contactId.trim();
  if (/^qq:(private|group):.+$/.test(trimmed)) return trimmed;
  if (/^(private|group):.+$/.test(trimmed)) return `${QQ_CONTACT_PREFIX}${trimmed}`;
  return `${QQ_CONTACT_PREFIX}private:${trimmed}`;
}

export async function createWechatBinding(data: InsertWechatBinding) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(wechatBindings)
    .set({ isActive: false })
    .where(and(
      eq(wechatBindings.personaId, data.personaId),
      eq(wechatBindings.userId, data.userId),
      eq(wechatBindings.isActive, true),
      eq(wechatBindings.wechatContactId, data.wechatContactId),
      nonQqBindingFilter(),
    ));
  if (data.wechatName) {
    await db.update(wechatBindings)
      .set({ isActive: false })
      .where(and(
        eq(wechatBindings.personaId, data.personaId),
        eq(wechatBindings.userId, data.userId),
        eq(wechatBindings.isActive, true),
        eq(wechatBindings.wechatName, data.wechatName),
        nonQqBindingFilter(),
      ));
  }
  const [result] = await db.insert(wechatBindings).values(data).returning({ id: wechatBindings.id });
  return result.id;
}

export async function getWechatBindingsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(wechatBindings).where(and(
    eq(wechatBindings.userId, userId),
    eq(wechatBindings.isActive, true),
    nonQqBindingFilter(),
  ));
}

export async function getActiveWechatBindingsByPersonaId(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(wechatBindings)
    .where(and(
      eq(wechatBindings.personaId, personaId),
      eq(wechatBindings.userId, userId),
      eq(wechatBindings.isActive, true),
      nonQqBindingFilter(),
    ))
    .orderBy(desc(wechatBindings.createdAt));

  const seen = new Set<string>();
  return rows.filter((row) => {
    const keys = [
      row.wechatName?.trim() ? `name:${row.wechatName.trim().toLowerCase()}` : "",
      row.wechatContactId ? `id:${row.wechatContactId}` : "",
    ].filter(Boolean);
    if (keys.some((key) => seen.has(key))) return false;
    keys.forEach((key) => seen.add(key));
    return true;
  });
}

export async function getWechatBindingByContactId(contactId: string) {
  if (isQqContactId(contactId)) return undefined;
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(wechatBindings)
    .where(and(eq(wechatBindings.wechatContactId, contactId), eq(wechatBindings.isActive, true))).limit(1);
  return result[0];
}

export async function createQqBinding(data: {
  personaId: number;
  userId: number;
  qqContactId: string;
  qqName?: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const qqContactId = normalizeQqContactId(data.qqContactId);

  await db.update(wechatBindings)
    .set({ isActive: false })
    .where(and(
      eq(wechatBindings.personaId, data.personaId),
      eq(wechatBindings.userId, data.userId),
      eq(wechatBindings.isActive, true),
      eq(wechatBindings.wechatContactId, qqContactId),
      qqBindingFilter(),
    ));

  if (data.qqName) {
    await db.update(wechatBindings)
      .set({ isActive: false })
      .where(and(
        eq(wechatBindings.personaId, data.personaId),
        eq(wechatBindings.userId, data.userId),
        eq(wechatBindings.isActive, true),
        eq(wechatBindings.wechatName, data.qqName),
        qqBindingFilter(),
      ));
  }

  const [result] = await db.insert(wechatBindings).values({
    personaId: data.personaId,
    userId: data.userId,
    wechatContactId: qqContactId,
    wechatName: data.qqName ?? null,
  }).returning({ id: wechatBindings.id });
  return result.id;
}

export async function getQqBindingsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(wechatBindings).where(and(
    eq(wechatBindings.userId, userId),
    eq(wechatBindings.isActive, true),
    qqBindingFilter(),
  ));
}

export async function listActiveQqBindingContactIds() {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({ contactId: wechatBindings.wechatContactId })
    .from(wechatBindings)
    .where(and(eq(wechatBindings.isActive, true), qqBindingFilter()))
    .orderBy(desc(wechatBindings.createdAt));

  const seen = new Set<string>();
  return rows
    .map(row => row.contactId?.trim())
    .filter((contactId): contactId is string => Boolean(contactId))
    .filter((contactId) => {
      if (seen.has(contactId)) return false;
      seen.add(contactId);
      return true;
    });
}

export async function getLatestQqMessageCreatedAt(): Promise<Date | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({ createdAt: messages.createdAt })
    .from(messages)
    .where(eq(messages.channel, "qq"))
    .orderBy(desc(messages.createdAt))
    .limit(1);
  return rows[0]?.createdAt ?? null;
}

export async function getActiveQqBindingsByPersonaId(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(wechatBindings)
    .where(and(
      eq(wechatBindings.personaId, personaId),
      eq(wechatBindings.userId, userId),
      eq(wechatBindings.isActive, true),
      qqBindingFilter(),
    ))
    .orderBy(desc(wechatBindings.createdAt));

  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = row.wechatContactId?.trim();
    if (!key) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function getQqBindingByContactId(contactId: string) {
  if (!isQqContactId(contactId)) return undefined;
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(wechatBindings)
    .where(and(
      eq(wechatBindings.wechatContactId, contactId),
      eq(wechatBindings.isActive, true),
      qqBindingFilter(),
    ))
    .limit(1);
  return result[0];
}

export async function deleteQqBinding(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(wechatBindings).where(and(
    eq(wechatBindings.id, id),
    eq(wechatBindings.userId, userId),
    qqBindingFilter(),
  ));
}

export async function getSingleReadyPersonaForQqAutoBind() {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db
    .select({
      id: personas.id,
      userId: personas.userId,
      name: personas.name,
    })
    .from(personas)
    .where(eq(personas.analysisStatus, "ready"))
    .orderBy(asc(personas.id))
    .limit(2);

  return result.length === 1 ? result[0] : undefined;
}

export async function deleteWechatBinding(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(wechatBindings).where(and(eq(wechatBindings.id, id), eq(wechatBindings.userId, userId)));
}

// ─── Skill Job helpers ──────────────────────────────────────────────────────

export async function createSkillJob(data: InsertSkillJob) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(skillJobs).values(data).returning({ id: skillJobs.id });
  return result.id;
}

export async function getSkillJobById(id: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(skillJobs)
    .where(and(eq(skillJobs.id, id), eq(skillJobs.userId, userId)))
    .limit(1);
  return result[0];
}

export async function updateSkillJob(id: number, data: Partial<InsertSkillJob>) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(skillJobs).set(data).where(eq(skillJobs.id, id));
}

// ─── LLM Config helpers ────────────────────────────────────────────────────

const DEFAULT_LLM_EXTRA_CONFIG = {
  temperature: 0.7,
  maxTokens: 4096,
  contextLimit: 20,
};

const LLM_PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  openai: "OpenAI",
  kimi: "Kimi",
  qwen: "Qwen",
  tongyi: "Qwen",
  deepseek: "DeepSeek",
  doubao: "Doubao",
  "302ai": "302AI",
  claude: "Claude",
  ollama: "Ollama",
  xunfei: "xunfei",
  dify: "dify",
};

function getEnvDefaultLlmProviderName() {
  const configured = ENV.defaultLlmProvider || "openai";
  return LLM_PROVIDER_DISPLAY_NAMES[configured.toLowerCase()] ?? configured;
}

export async function getLlmConfigsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(llmConfigs).where(eq(llmConfigs.userId, userId));
}

export async function upsertLlmConfig(userId: number, data: Partial<InsertLlmConfig> & { providerName: string }) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const currentDefault = await db.select({ id: llmConfigs.id }).from(llmConfigs)
    .where(and(eq(llmConfigs.userId, userId), eq(llmConfigs.isDefault, true))).limit(1);
  const dataWithDefault = currentDefault[0] ? data : { ...data, isDefault: data.isDefault ?? true };
  const existing = await db.select().from(llmConfigs)
    .where(and(eq(llmConfigs.userId, userId), eq(llmConfigs.providerName, data.providerName))).limit(1);
  if (existing[0]) {
    await db.update(llmConfigs).set(dataWithDefault).where(eq(llmConfigs.id, existing[0].id));
    return existing[0].id;
  }
  const [result] = await db.insert(llmConfigs).values({ userId, ...dataWithDefault }).returning({ id: llmConfigs.id });
  return result.id;
}

export async function setDefaultLlmConfig(userId: number, providerName: string) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const existing = await db.select({ id: llmConfigs.id }).from(llmConfigs)
    .where(and(eq(llmConfigs.userId, userId), eq(llmConfigs.providerName, providerName))).limit(1);
  if (!existing[0]) {
    await db.insert(llmConfigs).values({ userId, providerName, isDefault: false });
  }
  await db.update(llmConfigs).set({ isDefault: false }).where(eq(llmConfigs.userId, userId));
  await db.update(llmConfigs).set({ isDefault: true })
    .where(and(eq(llmConfigs.userId, userId), eq(llmConfigs.providerName, providerName)));
}

export async function getDefaultLlmConfig(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(llmConfigs)
    .where(and(eq(llmConfigs.userId, userId), eq(llmConfigs.isDefault, true))).limit(1);
  if (rows[0]) return rows[0];

  const existingRows = await db.select().from(llmConfigs)
    .where(eq(llmConfigs.userId, userId))
    .orderBy(asc(llmConfigs.id))
    .limit(1);
  if (existingRows[0]) {
    await setDefaultLlmConfig(userId, existingRows[0].providerName);
    return { ...existingRows[0], isDefault: true };
  }

  const providerName = getEnvDefaultLlmProviderName();
  const [created] = await db.insert(llmConfigs).values({
    userId,
    providerName,
    isDefault: true,
    extraConfig: DEFAULT_LLM_EXTRA_CONFIG,
  }).returning();
  return created ?? null;
}

// ─── Daily Activity helpers ────────────────────────────────────────────────

export async function getDailyChatCounts(userId: number, days = 30) {
  const db = await getDb();
  if (!db) return [];
  const since = new Date();
  since.setDate(since.getDate() - days);
  const rows = await db.select({
    date: sql<string>`DATE(${messages.createdAt})`,
    count: count(),
  })
    .from(messages)
    .where(and(eq(messages.userId, userId), gte(messages.createdAt, since)))
    .groupBy(sql`DATE(${messages.createdAt})`);
  return rows;
}

// ─── WeChat Bot State helpers ───────────────────────────────────────────────

export async function getWechatBotState(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(wechatBotState).where(eq(wechatBotState.userId, userId)).limit(1);
  return result[0];
}

export async function upsertWechatBotState(userId: number, data: Partial<{ status: string; qrCodeUrl: string | null; loggedInUser: string | null; lastError: string | null }>) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const existing = await db.select().from(wechatBotState).where(eq(wechatBotState.userId, userId)).limit(1);
  if (existing[0]) {
    await db.update(wechatBotState).set(data as any).where(eq(wechatBotState.id, existing[0].id));
    return existing[0].id;
  }
  const [result] = await db.insert(wechatBotState).values({ userId, ...data } as any).returning({ id: wechatBotState.id });
  return result.id;
}

// ─── Intimacy helpers ─────────────────────────────────────────────────────

export async function getIntimacyData(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return { chatCount: 0, totalMessages: 0, memoryCount: 0, emotionVariety: 0, daysSinceCreation: 0, consecutiveDays: 0 };
  const persona = await db.select({ chatCount: personas.chatCount, createdAt: personas.createdAt }).from(personas)
    .where(and(eq(personas.id, personaId), eq(personas.userId, userId))).limit(1);
  if (!persona[0]) return { chatCount: 0, totalMessages: 0, memoryCount: 0, emotionVariety: 0, daysSinceCreation: 0, consecutiveDays: 0 };
  const [msgCount] = await db.select({ c: count() }).from(messages).where(eq(messages.personaId, personaId));
  const [memCount] = await db.select({ c: count() }).from(memories).where(eq(memories.personaId, personaId));
  const emotionRows = await db.select({ s: emotionSnapshots.emotionalState }).from(emotionSnapshots)
    .where(eq(emotionSnapshots.personaId, personaId)).groupBy(emotionSnapshots.emotionalState);
  const daysSinceCreation = Math.floor((Date.now() - new Date(persona[0].createdAt).getTime()) / 86400000);
  const recentDays = await db.select({ d: sql<string>`DATE(${messages.createdAt})` }).from(messages)
    .where(eq(messages.personaId, personaId)).groupBy(sql`DATE(${messages.createdAt})`).orderBy(desc(sql`DATE(${messages.createdAt})`)).limit(30);
  let consecutiveDays = 0;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (let i = 0; i < recentDays.length; i++) {
    const expected = new Date(today); expected.setDate(expected.getDate() - i);
    if (recentDays[i].d === expected.toISOString().slice(0, 10)) consecutiveDays++;
    else break;
  }
  return {
    chatCount: persona[0].chatCount,
    totalMessages: msgCount?.c || 0,
    memoryCount: memCount?.c || 0,
    emotionVariety: emotionRows.length,
    daysSinceCreation,
    consecutiveDays,
  };
}

export async function updateIntimacy(personaId: number, userId: number, score: number, level: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(personas).set({ intimacyScore: score, intimacyLevel: level })
    .where(and(eq(personas.id, personaId), eq(personas.userId, userId)));
}

// ─── Memory helpers ───────────────────────────────────────────────────────

let memoryTableColumnsEnsured = false;

export async function ensureMemoryTableColumns() {
  if (memoryTableColumnsEnsured) return true;
  const db = await getDb();
  if (!db) return false;

  await db.execute(sql`ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "source" varchar(50) DEFAULT 'manual' NOT NULL`);
  await db.execute(sql`ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "memoryType" varchar(50) DEFAULT 'relationship_event' NOT NULL`);
  await db.execute(sql`ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "importance" integer DEFAULT 3 NOT NULL`);
  await db.execute(sql`ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "confidence" integer DEFAULT 3 NOT NULL`);
  await db.execute(sql`ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "keywords" jsonb`);
  await db.execute(sql`ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "emotion" varchar(50)`);
  await db.execute(sql`ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "validFrom" varchar(50)`);
  await db.execute(sql`ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "validTo" varchar(50)`);
  await db.execute(sql`ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "lastAccessedAt" timestamp`);
  await db.execute(sql`ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "evidenceMessageIds" jsonb`);
  await db.execute(sql`ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "status" varchar(50) DEFAULT 'active' NOT NULL`);
  await db.execute(sql`ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "followUpAt" timestamp`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "memories_persona_user_status_idx" ON "memories" ("personaId", "userId", "status")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "memories_type_idx" ON "memories" ("memoryType")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "memories_last_accessed_idx" ON "memories" ("lastAccessedAt")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "memories_follow_up_idx" ON "memories" ("personaId", "userId", "followUpAt")`);

  memoryTableColumnsEnsured = true;
  return true;
}

export async function createMemory(data: InsertMemory) {
  await ensureMemoryTableColumns();
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(memories).values(data).returning({ id: memories.id });
  return result.id;
}

export async function getMemoriesByPersonaId(personaId: number, userId: number) {
  await ensureMemoryTableColumns();
  const db = await getDb();
  if (!db) return [];
  return db.select().from(memories)
    .where(and(eq(memories.personaId, personaId), eq(memories.userId, userId)))
    .orderBy(desc(memories.createdAt));
}

export async function getActiveMemoriesByPersonaId(personaId: number, userId: number) {
  await ensureMemoryTableColumns();
  const db = await getDb();
  if (!db) return [];
  return db.select().from(memories)
    .where(and(eq(memories.personaId, personaId), eq(memories.userId, userId), eq(memories.status, "active")))
    .orderBy(desc(memories.createdAt));
}

/**
 * 到期的「关心回访」：open_loop 且 followUpAt<=now 的活跃记忆。
 * 主动消息用它自然问起用户之前提过的事；followUpAt 为 NULL 的不会命中（lte 对 NULL 判否）。
 */
export async function getDueFollowUps(personaId: number, userId: number, now = new Date(), limit = 3) {
  await ensureMemoryTableColumns();
  const db = await getDb();
  if (!db) return [];
  return db.select().from(memories)
    .where(and(
      eq(memories.personaId, personaId),
      eq(memories.userId, userId),
      eq(memories.status, "active"),
      eq(memories.memoryType, "open_loop"),
      lte(memories.followUpAt, now),
    ))
    .orderBy(asc(memories.followUpAt))
    .limit(limit);
}

/** 已经主动问起后清掉 followUpAt（保留记忆本身），避免反复回访同一件事。 */
export async function markFollowUpDone(id: number, userId: number) {
  await ensureMemoryTableColumns();
  const db = await getDb();
  if (!db) return;
  await db.update(memories)
    .set({ followUpAt: null })
    .where(and(eq(memories.id, id), eq(memories.userId, userId)));
}

const PINNED_FACT_MEMORY_TYPES = ["user_fact", "promise", "preference"] as const;

/**
 * 常驻用户状态事实：高重要度的 user_fact / promise / preference 记忆，
 * 每轮直接注入系统提示词，不依赖召回判断，用于防止"说了多遍仍遗忘"。
 */
export async function getPinnedMemoryFacts(personaId: number, userId: number, limit = 6): Promise<string[]> {
  await ensureMemoryTableColumns();
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(memories)
    .where(and(
      eq(memories.personaId, personaId),
      eq(memories.userId, userId),
      eq(memories.status, "active"),
      inArray(memories.memoryType, [...PINNED_FACT_MEMORY_TYPES]),
      gte(memories.importance, 4),
    ))
    .orderBy(desc(memories.importance), desc(memories.createdAt))
    .limit(limit);
  return rows.map(row => {
    const desc = (row.description || "").trim();
    return desc ? `${row.title}：${desc}` : row.title;
  });
}

export async function getMemoryByTitleAndDate(personaId: number, userId: number, title: string, date: string) {
  await ensureMemoryTableColumns();
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(memories)
    .where(and(
      eq(memories.personaId, personaId),
      eq(memories.userId, userId),
      eq(memories.title, title),
      eq(memories.date, date),
    ))
    .limit(1);
  return rows[0];
}

export async function getMemoryBySourceAndDate(personaId: number, userId: number, source: string, date: string) {
  await ensureMemoryTableColumns();
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(memories)
    .where(and(
      eq(memories.personaId, personaId),
      eq(memories.userId, userId),
      eq(memories.source, source),
      eq(memories.date, date),
    ))
    .limit(1);
  return rows[0];
}

export async function touchMemoriesByIds(ids: number[], userId: number) {
  await ensureMemoryTableColumns();
  const db = await getDb();
  if (!db || ids.length === 0) return;
  await db.update(memories)
    .set({ lastAccessedAt: new Date() })
    .where(and(inArray(memories.id, ids), eq(memories.userId, userId)));
}

export async function updateMemory(id: number, userId: number, data: Partial<InsertMemory>) {
  await ensureMemoryTableColumns();
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(memories).set(data).where(and(eq(memories.id, id), eq(memories.userId, userId)));
}

export async function deleteMemory(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(memories).where(and(eq(memories.id, id), eq(memories.userId, userId)));
}

// ─── Emotion Snapshot helpers ─────────────────────────────────────────────

export async function createEmotionSnapshot(data: InsertEmotionSnapshot) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(emotionSnapshots).values(data).returning({ id: emotionSnapshots.id });
  return result.id;
}

export async function getEmotionSnapshots(personaId: number, days = 30) {
  const db = await getDb();
  if (!db) return [];
  const since = new Date();
  since.setDate(since.getDate() - days);
  return db.select().from(emotionSnapshots)
    .where(and(eq(emotionSnapshots.personaId, personaId), gte(emotionSnapshots.createdAt, since)))
    .orderBy(emotionSnapshots.date);
}

export async function getEmotionReport(personaId: number, days = 30) {
  const db = await getDb();
  if (!db) return { snapshots: [], distribution: [], totalDays: 0, totalMessages: 0 };
  const since = new Date();
  since.setDate(since.getDate() - days);
  const snapshots = await db.select().from(emotionSnapshots)
    .where(and(eq(emotionSnapshots.personaId, personaId), gte(emotionSnapshots.createdAt, since)))
    .orderBy(emotionSnapshots.date);
  const distribution = await db.select({
    emotionalState: emotionSnapshots.emotionalState,
    count: count(),
  }).from(emotionSnapshots)
    .where(and(eq(emotionSnapshots.personaId, personaId), gte(emotionSnapshots.createdAt, since)))
    .groupBy(emotionSnapshots.emotionalState);
  const totalMessages = snapshots.reduce((sum, s) => sum + s.messageCount, 0);
  return { snapshots, distribution, totalDays: snapshots.length, totalMessages };
}

export async function getTodaySnapshot(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const today = new Date().toISOString().slice(0, 10);
  const rows = await db.select().from(emotionSnapshots)
    .where(and(eq(emotionSnapshots.personaId, personaId), eq(emotionSnapshots.userId, userId), eq(emotionSnapshots.date, today)))
    .limit(1);
  return rows[0];
}

// ─── Analytics helpers ────────────────────────────────────────────────────

export async function getMessageVolume(userId: number, days: number) {
  const db = await getDb();
  if (!db) return [];
  const since = new Date(); since.setDate(since.getDate() - days);
  return db.select({ date: sql<string>`DATE(${messages.createdAt})`, count: count() })
    .from(messages).where(and(eq(messages.userId, userId), gte(messages.createdAt, since)))
    .groupBy(sql`DATE(${messages.createdAt})`).orderBy(sql`DATE(${messages.createdAt})`);
}

export async function getEmotionTimeline(userId: number, days: number) {
  const db = await getDb();
  if (!db) return [];
  const since = new Date(); since.setDate(since.getDate() - days);
  return db.select({
    date: emotionSnapshots.date,
    emotionalState: emotionSnapshots.emotionalState,
    count: count(),
  }).from(emotionSnapshots)
    .where(and(eq(emotionSnapshots.userId, userId), gte(emotionSnapshots.createdAt, since)))
    .groupBy(emotionSnapshots.date, emotionSnapshots.emotionalState)
    .orderBy(emotionSnapshots.date);
}

export async function getPersonaEngagement(userId: number, days: number) {
  const db = await getDb();
  if (!db) return [];
  const since = new Date(); since.setDate(since.getDate() - days);
  return db.select({
    personaId: messages.personaId,
    name: personas.name,
    messageCount: count(),
  }).from(messages)
    .innerJoin(personas, eq(messages.personaId, personas.id))
    .where(and(eq(messages.userId, userId), gte(messages.createdAt, since)))
    .groupBy(messages.personaId, personas.name)
    .orderBy(desc(count()));
}

export async function getHourlyDistribution(userId: number, days: number) {
  const db = await getDb();
  if (!db) return [];
  const since = new Date(); since.setDate(since.getDate() - days);
  return db.select({
    hour: sql<number>`EXTRACT(HOUR FROM ${messages.createdAt})::int`,
    count: count(),
  }).from(messages)
    .where(and(eq(messages.userId, userId), gte(messages.createdAt, since)))
    .groupBy(sql`EXTRACT(HOUR FROM ${messages.createdAt})`);
}

export async function getAnalyticsStats(userId: number, days: number) {
  const db = await getDb();
  if (!db) return { totalMessages: 0, activeDays: 0, longestStreak: 0, avgPerDay: 0 };
  const since = new Date(); since.setDate(since.getDate() - days);
  const [msgCount] = await db.select({ c: count() }).from(messages)
    .where(and(eq(messages.userId, userId), gte(messages.createdAt, since)));
  const activeDaysRows = await db.select({ d: sql<string>`DATE(${messages.createdAt})` }).from(messages)
    .where(and(eq(messages.userId, userId), gte(messages.createdAt, since)))
    .groupBy(sql`DATE(${messages.createdAt})`).orderBy(sql`DATE(${messages.createdAt})`);
  const activeDays = activeDaysRows.length;
  let longestStreak = 0, currentStreak = 0;
  for (let i = 0; i < activeDaysRows.length; i++) {
    if (i === 0) { currentStreak = 1; }
    else {
      const prev = new Date(activeDaysRows[i - 1].d);
      const curr = new Date(activeDaysRows[i].d);
      const diff = (curr.getTime() - prev.getTime()) / 86400000;
      currentStreak = diff === 1 ? currentStreak + 1 : 1;
    }
    longestStreak = Math.max(longestStreak, currentStreak);
  }
  return { totalMessages: msgCount?.c || 0, activeDays, longestStreak, avgPerDay: activeDays > 0 ? Math.round((msgCount?.c || 0) / activeDays) : 0 };
}

// ─── Diary helpers ────────────────────────────────────────────────────────

export async function createDiaryEntry(data: InsertDiaryEntry) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(diaryEntries).values(data).returning({ id: diaryEntries.id });
  return result.id;
}

export async function getDiaryEntries(userId: number, personaId?: number, limit = 30) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(diaryEntries.userId, userId)];
  if (personaId) conditions.push(eq(diaryEntries.personaId, personaId));
  const rows = await db.select({
    id: diaryEntries.id, personaId: diaryEntries.personaId, date: diaryEntries.date,
    summary: diaryEntries.summary, highlights: diaryEntries.highlights,
    emotionalArc: diaryEntries.emotionalArc, quotes: diaryEntries.quotes,
    reflection: diaryEntries.reflection, messageCount: diaryEntries.messageCount,
    createdAt: diaryEntries.createdAt, personaName: personas.name,
  }).from(diaryEntries)
    .innerJoin(personas, eq(diaryEntries.personaId, personas.id))
    .where(and(...conditions))
    .orderBy(desc(diaryEntries.date))
    .limit(limit);
  return rows;
}

export async function getDiaryByDate(personaId: number, userId: number, date: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(diaryEntries)
    .where(and(eq(diaryEntries.personaId, personaId), eq(diaryEntries.userId, userId), eq(diaryEntries.date, date)))
    .limit(1);
  return rows[0];
}

export async function deleteDiaryEntry(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(diaryEntries).where(and(eq(diaryEntries.id, id), eq(diaryEntries.userId, userId)));
}

export async function getMessagesByDate(personaId: number, userId: number, date: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(messages)
    .where(and(eq(messages.personaId, personaId), eq(messages.userId, userId), sql`DATE(${messages.createdAt}) = ${date}`))
    .orderBy(asc(messages.createdAt));
}

export async function getDiaryDates(userId: number, personaId?: number) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(diaryEntries.userId, userId)];
  if (personaId) conditions.push(eq(diaryEntries.personaId, personaId));
  const rows = await db.select({ date: diaryEntries.date }).from(diaryEntries).where(and(...conditions));
  return rows.map(r => r.date);
}

// ─── SCENES ──────────────────────────────────────────────────────────────────

const BUILTIN_SCENES: InsertScene[] = [
  { name: "一起看电影", icon: "🎬", description: "窝在沙发上一起看电影，分享感受", systemPromptOverlay: "你们正在一起看电影，气氛温馨浪漫。你会评论剧情、分享感受，偶尔靠近对方。", emotionalState: "warm", starters: ["今天想看什么类型的电影？", "我准备好爆米花了~", "上次那部电影你还记得吗？"], isBuiltin: true },
  { name: "深夜聊天", icon: "🌙", description: "夜深人静，说些白天不会说的话", systemPromptOverlay: "现在是深夜，周围很安静。你的语气更加柔软、私密，愿意分享内心深处的想法和感受。", emotionalState: "nostalgic", starters: ["睡不着吗？", "夜深了，在想什么呢...", "这个时间特别想你"], isBuiltin: true },
  { name: "吵架和好", icon: "💔", description: "经历小摩擦后的和解", systemPromptOverlay: "你们之间刚发生了一点小矛盾，你有些委屈但也想和好。语气带着一点赌气但又舍不得真的生气。", emotionalState: "melancholy", starters: ["你还在生气吗...", "我不是故意的", "我们别吵了好不好"], isBuiltin: true },
  { name: "一起旅行", icon: "✈️", description: "想象一起去远方旅行", systemPromptOverlay: "你们正在一起旅行，心情愉快兴奋。你会描述看到的风景、分享旅途趣事，充满期待和快乐。", emotionalState: "happy", starters: ["下一站想去哪里？", "快看那边的风景！", "旅途中最开心的就是有你在身边"], isBuiltin: true },
  { name: "纪念日", icon: "🎂", description: "庆祝你们的特别日子", systemPromptOverlay: "今天是你们的纪念日，你特别开心和感动。你会回忆过去的美好时光，表达珍惜和感恩。", emotionalState: "happy", starters: ["今天是我们的特别日子呢", "还记得我们第一次见面吗？", "谢谢你一直在我身边"], isBuiltin: true },
];

async function seedBuiltinScenes(db: ReturnType<typeof drizzle>) {
  const existing = await db.select({ id: scenes.id }).from(scenes).where(eq(scenes.isBuiltin, true)).limit(1);
  if (existing.length > 0) return;
  for (const s of BUILTIN_SCENES) {
    await db.insert(scenes).values(s);
  }
}

export async function getScenes(userId: number) {
  const db = await getDb();
  if (!db) return [];
  await seedBuiltinScenes(db);
  return db.select().from(scenes)
    .where(sql`${scenes.isBuiltin} = true OR ${scenes.userId} = ${userId}`)
    .orderBy(desc(scenes.isBuiltin), asc(scenes.createdAt));
}

export async function getSceneById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select().from(scenes).where(eq(scenes.id, id)).limit(1);
  return row || null;
}

export async function createScene(data: InsertScene) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [row] = await db.insert(scenes).values(data).returning();
  return row;
}

export async function deleteScene(id: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(scenes).where(and(eq(scenes.id, id), eq(scenes.isBuiltin, false), eq(scenes.userId, userId)));
}

/** 编辑场景：只允许改自己创建的非内置场景。 */
export async function updateScene(id: number, userId: number, data: Partial<InsertScene>) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.update(scenes)
    .set(data)
    .where(and(eq(scenes.id, id), eq(scenes.isBuiltin, false), eq(scenes.userId, userId)))
    .returning();
  return row || null;
}

export async function activateScene(personaId: number, sceneId: number | null) {
  const db = await getDb();
  if (!db) return;
  await db.update(personas).set({ activeSceneId: sceneId, updatedAt: new Date() }).where(eq(personas.id, personaId));
}

// ─── Export helpers ─────────────────────────────────────────────────────────

export async function getExportData(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return null;
  await ensurePersonaRuntimeStatesTable();
  const [persona] = await db.select().from(personas)
    .where(and(eq(personas.id, personaId), eq(personas.userId, userId)));
  if (!persona) return null;
  const runtime = await getPersonaRuntimeStateRow(personaId, userId);
  const hydratedPersona = mergePersonaRuntimeRow(persona, runtime);
  const allMessages = await db.select().from(messages)
    .where(and(eq(messages.personaId, personaId), eq(messages.userId, userId)))
    .orderBy(asc(messages.createdAt));
  const allMemories = await db.select().from(memories)
    .where(eq(memories.personaId, personaId))
    .orderBy(asc(memories.createdAt));
  const allSnapshots = await db.select().from(emotionSnapshots)
    .where(eq(emotionSnapshots.personaId, personaId))
    .orderBy(asc(emotionSnapshots.date));
  const allDiaries = await db.select().from(diaryEntries)
    .where(and(eq(diaryEntries.personaId, personaId), eq(diaryEntries.userId, userId)))
    .orderBy(asc(diaryEntries.date));
  return { persona: hydratedPersona, messages: allMessages, memories: allMemories, emotionSnapshots: allSnapshots, diaryEntries: allDiaries };
}

// ─── Graduation helpers ─────────────────────────────────────────────────────

export async function getRecentEmotionTrend(personaId: number, days: number = 14) {
  const db = await getDb();
  if (!db) return [];
  const since = new Date();
  since.setDate(since.getDate() - days);
  return db.select({ emotionalState: emotionSnapshots.emotionalState })
    .from(emotionSnapshots)
    .where(and(eq(emotionSnapshots.personaId, personaId), gte(emotionSnapshots.createdAt, since)));
}

export async function getMessageCountInRange(personaId: number, startDaysAgo: number, endDaysAgo: number) {
  const db = await getDb();
  if (!db) return 0;
  const start = new Date(); start.setDate(start.getDate() - startDaysAgo);
  const end = new Date(); end.setDate(end.getDate() - endDaysAgo);
  const [result] = await db.select({ c: count() }).from(messages)
    .where(and(
      eq(messages.personaId, personaId),
      gte(messages.createdAt, start),
      sql`${messages.createdAt} < ${end}`
    ));
  return result?.c || 0;
}

export async function setGraduationStatus(
  personaId: number, userId: number,
  status: "suggested" | "graduated" | "declined" | null,
  farewellLetter?: string,
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const data: Record<string, any> = { graduationStatus: status, updatedAt: new Date() };
  if (status === "graduated") {
    data.graduatedAt = new Date();
    if (farewellLetter) data.farewellLetter = farewellLetter;
  }
  if (status === null) {
    data.graduatedAt = null;
    data.farewellLetter = null;
    data.graduationStatus = null;
  }
  await db.update(personas).set(data)
    .where(and(eq(personas.id, personaId), eq(personas.userId, userId)));
}
