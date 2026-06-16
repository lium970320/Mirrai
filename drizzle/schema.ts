import { boolean, integer, pgEnum, pgTable, serial, text, timestamp, varchar, jsonb } from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["user", "admin"]);
export const analysisStatusEnum = pgEnum("analysis_status", ["pending", "analyzing", "ready", "error"]);
export const emotionalStateEnum = pgEnum("emotional_state", ["warm", "playful", "nostalgic", "melancholy", "happy", "distant"]);
export const fileTypeEnum = pgEnum("file_type", ["chat_txt", "chat_csv", "image", "video"]);
export const processStatusEnum = pgEnum("process_status", ["uploaded", "processing", "done", "failed"]);
export const messageRoleEnum = pgEnum("message_role", ["user", "assistant"]);
export const channelEnum = pgEnum("channel", ["web", "wechat", "qq"]);
export const characterFamilyEnum = pgEnum("character_family", ["colleague", "relationship", "celebrity"]);
export const pipelineStageEnum = pgEnum("pipeline_stage", [
  "intake", "collecting", "analyzing_persona", "analyzing_work",
  "building", "merging", "correcting", "complete", "error",
]);
export const botStatusEnum = pgEnum("bot_status", ["stopped", "scanning", "logged_in", "error"]);
export const messageTypeEnum = pgEnum("message_type", ["text", "voice", "image"]);
export const memoryCategoryEnum = pgEnum("memory_category", ["milestone", "memory", "anniversary"]);
export const graduationStatusEnum = pgEnum("graduation_status", ["suggested", "graduated", "declined"]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: varchar("username", { length: 100 }).notNull().unique(),
  passwordHash: varchar("passwordHash", { length: 255 }),
  openId: varchar("openId", { length: 64 }).unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: roleEnum().default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const personas = pgTable("personas", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  avatarUrl: text("avatarUrl"),
  relationshipDesc: varchar("relationshipDesc", { length: 200 }),
  togetherFrom: varchar("togetherFrom", { length: 50 }),
  togetherTo: varchar("togetherTo", { length: 50 }),
  personaData: jsonb("personaData"),
  analysisStatus: analysisStatusEnum().default("pending").notNull(),
  analysisProgress: integer("analysisProgress").default(0).notNull(),
  analysisMessage: text("analysisMessage"),
  emotionalState: emotionalStateEnum().default("warm").notNull(),
  chatCount: integer("chatCount").default(0).notNull(),
  lastChatAt: timestamp("lastChatAt"),
  skillJobId: integer("skillJobId"),
  llmProvider: varchar("llmProvider", { length: 64 }),
  intimacyScore: integer("intimacyScore").default(0).notNull(),
  intimacyLevel: varchar("intimacyLevel", { length: 50 }).default("初识").notNull(),
  activeSceneId: integer("activeSceneId"),
  graduationStatus: graduationStatusEnum(),
  graduatedAt: timestamp("graduatedAt"),
  farewellLetter: text("farewellLetter"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type Persona = typeof personas.$inferSelect;
export type InsertPersona = typeof personas.$inferInsert;

export const personaFiles = pgTable("persona_files", {
  id: serial("id").primaryKey(),
  personaId: integer("personaId").notNull(),
  userId: integer("userId").notNull(),
  fileType: fileTypeEnum().notNull(),
  originalName: varchar("originalName", { length: 255 }).notNull(),
  fileKey: varchar("fileKey", { length: 500 }).notNull(),
  fileUrl: text("fileUrl").notNull(),
  fileSize: integer("fileSize").notNull(),
  extractedMemory: text("extractedMemory"),
  processStatus: processStatusEnum().default("uploaded").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type PersonaFile = typeof personaFiles.$inferSelect;
export type InsertPersonaFile = typeof personaFiles.$inferInsert;

export const personaSources = pgTable("persona_sources", {
  id: serial("id").primaryKey(),
  personaId: integer("personaId").notNull(),
  userId: integer("userId").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  sourceType: varchar("sourceType", { length: 50 }).default("epub").notNull(),
  originalName: varchar("originalName", { length: 255 }),
  fileHash: varchar("fileHash", { length: 128 }),
  metadata: jsonb("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type PersonaSource = typeof personaSources.$inferSelect;
export type InsertPersonaSource = typeof personaSources.$inferInsert;

export const personaSourceChunks = pgTable("persona_source_chunks", {
  id: serial("id").primaryKey(),
  sourceId: integer("sourceId").notNull(),
  personaId: integer("personaId").notNull(),
  userId: integer("userId").notNull(),
  chapterTitle: text("chapterTitle"),
  chunkIndex: integer("chunkIndex").notNull(),
  content: text("content").notNull(),
  keywords: jsonb("keywords"),
  tokenEstimate: integer("tokenEstimate"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type PersonaSourceChunk = typeof personaSourceChunks.$inferSelect;
export type InsertPersonaSourceChunk = typeof personaSourceChunks.$inferInsert;

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  personaId: integer("personaId").notNull(),
  userId: integer("userId").notNull(),
  role: messageRoleEnum().notNull(),
  content: text("content").notNull(),
  messageType: messageTypeEnum().default("text").notNull(),
  mediaUrl: text("mediaUrl"),
  mediaDuration: integer("mediaDuration"),
  emotionalState: varchar("emotionalState", { length: 50 }),
  channel: channelEnum().default("web").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Message = typeof messages.$inferSelect;
export type InsertMessage = typeof messages.$inferInsert;

export const roleplayChannels = pgTable("roleplay_channels", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  scenePrompt: text("scenePrompt"),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type RoleplayChannel = typeof roleplayChannels.$inferSelect;
export type InsertRoleplayChannel = typeof roleplayChannels.$inferInsert;

export const roleplayChannelMembers = pgTable("roleplay_channel_members", {
  id: serial("id").primaryKey(),
  channelId: integer("channelId").notNull(),
  userId: integer("userId").notNull(),
  personaId: integer("personaId").notNull(),
  displayOrder: integer("displayOrder").default(0).notNull(),
  speakingEnabled: boolean("speakingEnabled").default(true).notNull(),
  lastReadMessageId: integer("lastReadMessageId").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type RoleplayChannelMember = typeof roleplayChannelMembers.$inferSelect;
export type InsertRoleplayChannelMember = typeof roleplayChannelMembers.$inferInsert;

export const roleplayMessages = pgTable("roleplay_messages", {
  id: serial("id").primaryKey(),
  channelId: integer("channelId").notNull(),
  userId: integer("userId").notNull(),
  personaId: integer("personaId"),
  speakerName: varchar("speakerName", { length: 100 }).notNull(),
  role: varchar("role", { length: 32 }).default("persona").notNull(),
  content: text("content").notNull(),
  innerThought: text("innerThought"),
  moodState: jsonb("moodState"),
  turnKind: varchar("turnKind", { length: 50 }).default("dialogue").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type RoleplayMessage = typeof roleplayMessages.$inferSelect;
export type InsertRoleplayMessage = typeof roleplayMessages.$inferInsert;

export const personaRuntimeStates = pgTable("persona_runtime_states", {
  id: serial("id").primaryKey(),
  personaId: integer("personaId").notNull(),
  userId: integer("userId").notNull(),
  runtimeLifeState: jsonb("runtimeLifeState"),
  runtimeDiagnostics: jsonb("runtimeDiagnostics"),
  runtimeInnerState: jsonb("runtimeInnerState"),
  proactiveRuntime: jsonb("proactiveRuntime"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type PersonaRuntimeStateRow = typeof personaRuntimeStates.$inferSelect;
export type InsertPersonaRuntimeStateRow = typeof personaRuntimeStates.$inferInsert;

export const wechatBindings = pgTable("wechat_bindings", {
  id: serial("id").primaryKey(),
  personaId: integer("personaId").notNull(),
  userId: integer("userId").notNull(),
  wechatContactId: varchar("wechatContactId", { length: 255 }).notNull(),
  wechatName: varchar("wechatName", { length: 255 }),
  wechatAlias: varchar("wechatAlias", { length: 255 }),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type WechatBinding = typeof wechatBindings.$inferSelect;
export type InsertWechatBinding = typeof wechatBindings.$inferInsert;

export const skillJobs = pgTable("skill_jobs", {
  id: serial("id").primaryKey(),
  personaId: integer("personaId").notNull(),
  userId: integer("userId").notNull(),
  characterFamily: characterFamilyEnum().default("relationship").notNull(),
  pipelineStage: pipelineStageEnum().default("intake").notNull(),
  stageProgress: integer("stageProgress").default(0).notNull(),
  stageMessage: text("stageMessage"),
  inputMeta: jsonb("inputMeta"),
  analysisResult: jsonb("analysisResult"),
  generatedSkillPath: varchar("generatedSkillPath", { length: 500 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type SkillJob = typeof skillJobs.$inferSelect;
export type InsertSkillJob = typeof skillJobs.$inferInsert;

export const llmConfigs = pgTable("llm_configs", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  providerName: varchar("providerName", { length: 64 }).notNull(),
  isDefault: boolean("isDefault").default(false).notNull(),
  apiKey: varchar("apiKey", { length: 512 }),
  baseUrl: varchar("baseUrl", { length: 512 }),
  model: varchar("model", { length: 128 }),
  systemMessage: text("systemMessage"),
  extraConfig: jsonb("extraConfig"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type LlmConfig = typeof llmConfigs.$inferSelect;
export type InsertLlmConfig = typeof llmConfigs.$inferInsert;

export const llmUsageRecords = pgTable("llm_usage_records", {
  id: serial("id").primaryKey(),
  startedAt: timestamp("startedAt").notNull(),
  durationMs: integer("durationMs").default(0).notNull(),
  provider: varchar("provider", { length: 64 }).notNull(),
  requestedProvider: varchar("requestedProvider", { length: 64 }),
  model: varchar("model", { length: 128 }),
  purpose: varchar("purpose", { length: 64 }),
  userId: integer("userId"),
  personaId: integer("personaId"),
  route: varchar("route", { length: 128 }),
  success: boolean("success").default(true).notNull(),
  inputTokens: integer("inputTokens").default(0).notNull(),
  outputTokens: integer("outputTokens").default(0).notNull(),
  totalTokens: integer("totalTokens").default(0).notNull(),
  inputChars: integer("inputChars").default(0).notNull(),
  outputChars: integer("outputChars").default(0).notNull(),
  error: text("error"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type LlmUsageRecordRow = typeof llmUsageRecords.$inferSelect;
export type InsertLlmUsageRecordRow = typeof llmUsageRecords.$inferInsert;

export const wechatBotState = pgTable("wechat_bot_state", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  status: botStatusEnum().default("stopped").notNull(),
  qrCodeUrl: text("qrCodeUrl"),
  loggedInUser: varchar("loggedInUser", { length: 255 }),
  lastError: text("lastError"),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type WechatBotState = typeof wechatBotState.$inferSelect;
export type InsertWechatBotState = typeof wechatBotState.$inferInsert;

export const memories = pgTable("memories", {
  id: serial("id").primaryKey(),
  personaId: integer("personaId").notNull(),
  userId: integer("userId").notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  description: text("description"),
  category: memoryCategoryEnum().default("memory").notNull(),
  date: varchar("date", { length: 50 }),
  messageId: integer("messageId"),
  source: varchar("source", { length: 50 }).default("manual").notNull(),
  memoryType: varchar("memoryType", { length: 50 }).default("relationship_event").notNull(),
  importance: integer("importance").default(3).notNull(),
  confidence: integer("confidence").default(3).notNull(),
  keywords: jsonb("keywords"),
  emotion: varchar("emotion", { length: 50 }),
  validFrom: varchar("validFrom", { length: 50 }),
  validTo: varchar("validTo", { length: 50 }),
  lastAccessedAt: timestamp("lastAccessedAt"),
  evidenceMessageIds: jsonb("evidenceMessageIds"),
  status: varchar("status", { length: 50 }).default("active").notNull(),
  /** open_loop 记忆的「该回访」时间；到点后主动消息会自然问起。null 表示不需要主动回访。 */
  followUpAt: timestamp("followUpAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Memory = typeof memories.$inferSelect;
export type InsertMemory = typeof memories.$inferInsert;

export const emotionSnapshots = pgTable("emotion_snapshots", {
  id: serial("id").primaryKey(),
  personaId: integer("personaId").notNull(),
  userId: integer("userId").notNull(),
  emotionalState: varchar("emotionalState", { length: 50 }).notNull(),
  messageCount: integer("messageCount").default(0).notNull(),
  date: varchar("date", { length: 20 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type EmotionSnapshot = typeof emotionSnapshots.$inferSelect;
export type InsertEmotionSnapshot = typeof emotionSnapshots.$inferInsert;

export const diaryEntries = pgTable("diary_entries", {
  id: serial("id").primaryKey(),
  personaId: integer("personaId").notNull(),
  userId: integer("userId").notNull(),
  date: varchar("date", { length: 20 }).notNull(),
  summary: text("summary").notNull(),
  highlights: jsonb("highlights"),
  emotionalArc: jsonb("emotionalArc"),
  quotes: jsonb("quotes"),
  reflection: text("reflection"),
  messageCount: integer("messageCount").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type DiaryEntry = typeof diaryEntries.$inferSelect;
export type InsertDiaryEntry = typeof diaryEntries.$inferInsert;

export const scenes = pgTable("scenes", {
  id: serial("id").primaryKey(),
  userId: integer("userId"),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  icon: varchar("icon", { length: 10 }),
  systemPromptOverlay: text("systemPromptOverlay"),
  emotionalState: varchar("emotionalState", { length: 50 }),
  starters: jsonb("starters"),
  isBuiltin: boolean("isBuiltin").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Scene = typeof scenes.$inferSelect;
export type InsertScene = typeof scenes.$inferInsert;
