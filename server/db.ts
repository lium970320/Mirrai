import { eq, desc, and, sql, count, sum, gte, ilike, asc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  InsertUser, users,
  personas, personaFiles, messages,
  personaSources, personaSourceChunks,
  wechatBindings, skillJobs, llmConfigs, wechatBotState,
  memories, emotionSnapshots, diaryEntries, scenes,
  InsertPersona, InsertPersonaFile, InsertMessage,
  InsertPersonaSource, InsertPersonaSourceChunk,
  InsertWechatBinding, InsertSkillJob, InsertLlmConfig,
  InsertMemory, InsertEmotionSnapshot, InsertDiaryEntry, InsertScene,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

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

export async function deleteUserAccount(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(memories).where(eq(memories.userId, id));
  await db.delete(emotionSnapshots).where(eq(emotionSnapshots.userId, id));
  await db.delete(messages).where(eq(messages.userId, id));
  await db.delete(personaFiles).where(eq(personaFiles.userId, id));
  await db.delete(personaSourceChunks).where(eq(personaSourceChunks.userId, id));
  await db.delete(personaSources).where(eq(personaSources.userId, id));
  await db.delete(wechatBindings).where(eq(wechatBindings.userId, id));
  await db.delete(llmConfigs).where(eq(llmConfigs.userId, id));
  await db.delete(personas).where(eq(personas.userId, id));
  await db.delete(users).where(eq(users.id, id));
}

export async function getAccountStats(userId: number) {
  const db = await getDb();
  if (!db) return { totalPersonas: 0, totalChats: 0, totalMessages: 0, totalFiles: 0, storageUsed: 0 };
  const [personaCount] = await db.select({ c: count() }).from(personas).where(eq(personas.userId, userId));
  const [chatSum] = await db.select({ s: sum(personas.chatCount) }).from(personas).where(eq(personas.userId, userId));
  const [msgCount] = await db.select({ c: count() }).from(messages).where(eq(messages.userId, userId));
  const [fileCount] = await db.select({ c: count() }).from(personaFiles).where(eq(personaFiles.userId, userId));
  const [fileSize] = await db.select({ s: sum(personaFiles.fileSize) }).from(personaFiles).where(eq(personaFiles.userId, userId));
  return {
    totalPersonas: personaCount?.c || 0,
    totalChats: Number(chatSum?.s) || 0,
    totalMessages: msgCount?.c || 0,
    totalFiles: fileCount?.c || 0,
    storageUsed: Number(fileSize?.s) || 0,
  };
}

export async function exportUserData(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const [user] = await db.select({ username: users.username, name: users.name, email: users.email, createdAt: users.createdAt })
    .from(users).where(eq(users.id, userId));
  const personaList = await db.select().from(personas).where(eq(personas.userId, userId));
  const messageList = await db.select().from(messages).where(eq(messages.userId, userId)).orderBy(messages.createdAt);
  return { user, personas: personaList, messages: messageList };
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
  return db.select().from(personas).where(eq(personas.userId, userId)).orderBy(desc(personas.updatedAt));
}

export async function getReadyPersonasForProactiveMessages() {
  const db = await getDb();
  if (!db) return [];

  const list = await db
    .select()
    .from(personas)
    .where(eq(personas.analysisStatus, "ready"))
    .orderBy(asc(personas.id));

  return list.filter((p) => {
    const data = (p.personaData as any) || {};
    const proactive = data.proactiveMessages;
    return Boolean(proactive?.enabled && Array.isArray(proactive.times) && proactive.times.length > 0);
  });
}

export async function getPersonasWithStats(userId: number) {
  const db = await getDb();
  if (!db) return [];
  const list = await db.select().from(personas).where(eq(personas.userId, userId)).orderBy(desc(personas.updatedAt));
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
  const result = await db.select().from(personas)
    .where(and(eq(personas.id, id), eq(personas.userId, userId))).limit(1);
  return result[0];
}

export async function updatePersona(id: number, userId: number, data: Partial<InsertPersona>) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(personas).set(data).where(and(eq(personas.id, id), eq(personas.userId, userId)));
}

export async function deletePersona(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(memories).where(eq(memories.personaId, id));
  await db.delete(emotionSnapshots).where(eq(emotionSnapshots.personaId, id));
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

const COMMON_SOURCE_TERMS = new Set(["柱子", "王玉柱", "敏子", "王芃泽"]);

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
        matchedTerms: matchedTerms.length ? matchedTerms : bestSeed.matchedTerms,
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

export async function searchMessages(personaId: number, userId: number, query: string, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(messages)
    .where(and(eq(messages.personaId, personaId), eq(messages.userId, userId), ilike(messages.content, `%${query}%`)))
    .orderBy(desc(messages.createdAt))
    .limit(limit);
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

export async function getSingleReadyPersonaForWechatAutoBind() {
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

export async function getSkillJobById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(skillJobs).where(eq(skillJobs.id, id)).limit(1);
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

export async function createMemory(data: InsertMemory) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(memories).values(data).returning({ id: memories.id });
  return result.id;
}

export async function getMemoriesByPersonaId(personaId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(memories).where(eq(memories.personaId, personaId)).orderBy(desc(memories.createdAt));
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

export async function deleteScene(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(scenes).where(and(eq(scenes.id, id), eq(scenes.isBuiltin, false)));
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
  const [persona] = await db.select().from(personas)
    .where(and(eq(personas.id, personaId), eq(personas.userId, userId)));
  if (!persona) return null;
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
  return { persona, messages: allMessages, memories: allMemories, emotionSnapshots: allSnapshots, diaryEntries: allDiaries };
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
