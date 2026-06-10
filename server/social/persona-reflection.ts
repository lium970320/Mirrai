import { buildCurrentUserIdentityOverride } from "../_core/current-user-identity";
import { normalizePersonaProfileSections } from "../_core/persona-profile";
import { llmService } from "../llm";
import type {
  PersonaOutputMode,
  PersonaReplyLengthTarget,
  PersonaTurnIntent,
  PersonaTurnPlan,
  PersonaTurnPlatform,
  PersonaTurnRisk,
} from "./persona-turn-planner";

type RecentMessage = {
  role: string;
  content: string;
};

export type PersonaReflectionInput = {
  persona: any;
  platform: PersonaTurnPlatform;
  contactName: string;
  messageText: string;
  recentMessages: RecentMessage[];
  turnPlan: PersonaTurnPlan;
  sourceRecallActive?: boolean;
};

export type PersonaReflection = {
  intent: PersonaTurnIntent;
  shouldRecallMemory: boolean;
  memoryQueries: string[];
  shouldRecordMemory: boolean;
  recordReason: string;
  innerReaction: string;
  replyStrategy: string;
  replyLength: PersonaReplyLengthTarget;
  outputMode: PersonaOutputMode;
  risks: PersonaTurnRisk[];
  avoid: string[];
  mood: string;
};

const INTENTS: PersonaTurnIntent[] = [
  "daily_chat",
  "source_recall",
  "emotional_support",
  "affection_expression",
  "teasing",
  "technical",
  "media",
  "voice",
  "correction",
  "unknown",
];

const REPLY_LENGTHS: PersonaReplyLengthTarget[] = ["silent", "short", "medium", "long"];
const OUTPUT_MODES: PersonaOutputMode[] = ["text", "voice_candidate", "media_reply", "silent"];

const RISKS: PersonaTurnRisk[] = [
  "source_hallucination",
  "context_fragmentation",
  "sleep_state_conflict",
  "repetition",
  "over_reply",
  "persona_drift",
  "memory_contamination",
  "relationship_boundary",
  "emotion_mismatch",
  "none",
];

function compact(text: string, maxLength: number): string {
  const chars = Array.from(text.replace(/\s+/g, " ").trim());
  return chars.length <= maxLength ? chars.join("") : `${chars.slice(0, maxLength).join("")}...`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function textValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function boolValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function arrayOfText(value: unknown, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .map(item => textValue(item))
      .filter(Boolean)
      .map(item => compact(item, maxChars)),
  )).slice(0, maxItems);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const normalized = textValue(value).toLowerCase();
  return allowed.includes(normalized as T) ? normalized as T : fallback;
}

function normalizeRisks(value: unknown, fallback: PersonaTurnRisk[]): PersonaTurnRisk[] {
  if (!Array.isArray(value)) return fallback;
  const risks = value
    .map(item => oneOf(item, RISKS, "none"))
    .filter(Boolean);
  const unique = Array.from(new Set(risks));
  return unique.length > 0 ? unique.slice(0, 6) : fallback;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const stripped = (text || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(stripped);
    return asRecord(parsed);
  } catch {
    const match = stripped.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return asRecord(JSON.parse(match[0]));
    } catch {
      return null;
    }
  }
}

export function fallbackPersonaReflection(turnPlan: PersonaTurnPlan): PersonaReflection {
  const shouldRecallMemory = turnPlan.memoryMode === "relationship_ledger" || turnPlan.intent === "correction";
  const shouldRecordMemory = turnPlan.intent === "affection_expression"
    || turnPlan.intent === "emotional_support"
    || turnPlan.intent === "correction";
  return {
    intent: turnPlan.intent,
    shouldRecallMemory,
    memoryQueries: [],
    shouldRecordMemory,
    recordReason: shouldRecordMemory ? "本轮可能影响关系记忆，后续可由记忆整理任务判断是否沉淀。" : "",
    innerReaction: "",
    replyStrategy: turnPlan.reasons[0] || "自然接住用户本轮话语。",
    replyLength: turnPlan.replyLength,
    outputMode: turnPlan.outputMode,
    risks: turnPlan.risks,
    avoid: [],
    mood: "",
  };
}

export function parsePersonaReflectionResponse(response: string, fallback: PersonaReflection): PersonaReflection {
  const parsed = parseJsonObject(response);
  if (!parsed) return fallback;
  return {
    intent: oneOf(parsed.intent, INTENTS, fallback.intent),
    shouldRecallMemory: boolValue(parsed.shouldRecallMemory, fallback.shouldRecallMemory),
    memoryQueries: arrayOfText(parsed.memoryQueries, 6, 48),
    shouldRecordMemory: boolValue(parsed.shouldRecordMemory, fallback.shouldRecordMemory),
    recordReason: compact(textValue(parsed.recordReason, fallback.recordReason), 180),
    innerReaction: compact(textValue(parsed.innerReaction, fallback.innerReaction), 260),
    replyStrategy: compact(textValue(parsed.replyStrategy, fallback.replyStrategy), 260),
    replyLength: oneOf(parsed.replyLength, REPLY_LENGTHS, fallback.replyLength),
    outputMode: oneOf(parsed.outputMode, OUTPUT_MODES, fallback.outputMode),
    risks: normalizeRisks(parsed.risks, fallback.risks),
    avoid: arrayOfText(parsed.avoid, 8, 80),
    mood: compact(textValue(parsed.mood, fallback.mood), 50),
  };
}

function formatRecentMessages(messages: RecentMessage[]): string {
  return messages.slice(-8).map((message) => {
    const role = message.role === "user" ? "用户" : "角色";
    return `${role}：${compact(message.content, 180)}`;
  }).join("\n");
}

function personaSketch(persona: any): string {
  const data = (persona.personaData as any) || {};
  const profile = normalizePersonaProfileSections(data, {
    name: persona.name,
    relationshipDesc: persona.relationshipDesc,
    togetherFrom: persona.togetherFrom,
    togetherTo: persona.togetherTo,
  });
  return [
    `姓名：${persona.name}`,
    `关系：${persona.relationshipDesc || "重要的人"}`,
    profile.personality.traits ? `性格：${compact(profile.personality.traits, 220)}` : "",
    profile.relationship.feelingsForUser ? `对用户的感情：${compact(profile.relationship.feelingsForUser, 220)}` : "",
    profile.speaking.style ? `说话方式：${compact(profile.speaking.style, 180)}` : "",
    profile.relationship.boundaries ? `关系边界：${compact(profile.relationship.boundaries, 180)}` : "",
  ].filter(Boolean).join("\n");
}

function buildReflectionPrompt(input: PersonaReflectionInput): string {
  const plan = input.turnPlan;
  return [
    "你是角色回复前的“隐藏思考层”。你的任务不是替角色回复，而是先判断这一轮话应该怎么理解。",
    "这些内容只给后续回复模型看，不直接发给用户。不要写长篇心理小说，不要补聊天中没有证据的事实。",
    buildCurrentUserIdentityOverride("隐藏思考用户身份覆盖"),
    "",
    "人物简表：",
    personaSketch(input.persona),
    "",
    `入口：${input.platform}`,
    `联系人显示名：${input.contactName || "用户"}`,
    `本轮用户消息：${input.messageText}`,
    "",
    "最近上下文：",
    formatRecentMessages(input.recentMessages) || "无",
    "",
    "规则规划器的初步判断：",
    `intent=${plan.intent}; memoryMode=${plan.memoryMode}; replyLength=${plan.replyLength}; outputMode=${plan.outputMode}; risks=${plan.risks.join(",")}; sourceRecallActive=${input.sourceRecallActive ? "true" : "false"}`,
    "",
    "只返回 JSON 对象，字段含义如下：",
    "- intent：本轮意图，沿用给定枚举。",
    "- shouldRecallMemory：是否需要查长期关系记忆。",
    "- memoryQueries：如果要查记忆，用哪些短查询词检索；不要超过 6 条。",
    "- shouldRecordMemory：这轮是否可能值得以后记住；这里只是候选标记，不代表立刻写入。",
    "- recordReason：为什么值得或不值得记录。",
    "- innerReaction：角色内心如何理解这句话；要符合人物，不要直接当台词。",
    "- replyStrategy：真正回复时的策略。",
    "- replyLength：silent/short/medium/long。",
    "- outputMode：text/voice_candidate/media_reply/silent。",
    "- risks：本轮要防的风险。",
    "- avoid：回复时应该避免的具体话术或方向。",
    "- mood：角色此刻更细的心情词。",
    "",
    `可选 intent：${INTENTS.join(", ")}`,
    `可选 risks：${RISKS.join(", ")}`,
    `JSON 模板：{"intent":"${plan.intent}","shouldRecallMemory":true,"memoryQueries":["关键词"],"shouldRecordMemory":false,"recordReason":"","innerReaction":"","replyStrategy":"","replyLength":"${plan.replyLength}","outputMode":"${plan.outputMode}","risks":["none"],"avoid":[],"mood":""}`,
  ].join("\n");
}

export async function buildPersonaReflection(input: PersonaReflectionInput): Promise<PersonaReflection> {
  const fallback = fallbackPersonaReflection(input.turnPlan);
  try {
    const response = await llmService.invoke({
      messages: [
        {
          role: "system",
          content: [
            "你只做角色回复前的内部判断，必须返回严格 JSON。不要生成对用户说的话。",
            buildCurrentUserIdentityOverride("隐藏思考用户身份覆盖"),
          ].join("\n\n"),
        },
        { role: "user", content: buildReflectionPrompt(input) },
      ],
      options: {
        provider: input.persona.llmProvider || undefined,
        purpose: "reflection",
        userId: input.persona.userId,
        personaId: input.persona.id,
        route: `social.${input.platform}.reflection`,
        temperature: 0.2,
        maxTokens: 550,
      },
    });
    return parsePersonaReflectionResponse(response, fallback);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[PersonaReflection] failed persona=${input.persona.id}: ${reason}`);
    return fallback;
  }
}

export function formatPersonaReflectionInstruction(reflection: PersonaReflection): string {
  const lines = [
    "【隐藏思考层】",
    "以下是本轮回复前的内部判断，只用于帮助你理解用户，不要向用户解释这些字段，也不要把 innerReaction 原样说出来。",
    `意图：${reflection.intent}`,
    `是否查长期记忆：${reflection.shouldRecallMemory ? "是" : "否"}`,
    reflection.memoryQueries.length ? `记忆查询词：${reflection.memoryQueries.join("；")}` : "",
    reflection.innerReaction ? `内心反应：${reflection.innerReaction}` : "",
    reflection.replyStrategy ? `回复策略：${reflection.replyStrategy}` : "",
    reflection.mood ? `细分心情：${reflection.mood}` : "",
    `回复长度：${reflection.replyLength}`,
    reflection.risks.length ? `风险提示：${reflection.risks.join("；")}` : "",
    reflection.avoid.length ? `避免：${reflection.avoid.join("；")}` : "",
    reflection.shouldRecordMemory
      ? `记忆候选：${reflection.recordReason || "本轮可能值得后续整理为长期记忆。"}`
      : "",
  ].filter(Boolean);
  return lines.join("\n");
}
