import { cleanAssistantReply } from "../_core/reply-utils";
import { getCurrentLlmEconomyPolicy, type LlmEconomyPolicy } from "../llm/economy";
import { llmService, type LLMMessage, type LLMOptions } from "../llm";

const SOURCE_GROUNDED_MAX_TOKENS = 480;
const SOURCE_GROUNDED_TEMPERATURE = 0.25;

type SourceGroundingRewriteOptions = {
  personaName: string;
  userQuestion: string;
  sourceContext: string;
  draftReply: string;
  llmOptions?: LLMOptions;
  economyPolicy?: LlmEconomyPolicy;
};

function boundedMaxTokens(maxTokens: unknown, fallback = SOURCE_GROUNDED_MAX_TOKENS): number {
  return typeof maxTokens === "number" && Number.isFinite(maxTokens)
    ? Math.min(maxTokens, SOURCE_GROUNDED_MAX_TOKENS)
    : fallback;
}

function boundedTemperature(temperature: unknown): number {
  return typeof temperature === "number" && Number.isFinite(temperature)
    ? Math.min(temperature, SOURCE_GROUNDED_TEMPERATURE)
    : SOURCE_GROUNDED_TEMPERATURE;
}

export function sourceGroundedLlmOptions(options: LLMOptions = {}, maxTokensLimit = SOURCE_GROUNDED_MAX_TOKENS): LLMOptions {
  return {
    ...options,
    temperature: boundedTemperature(options.temperature),
    maxTokens: Math.min(boundedMaxTokens(options.maxTokens), maxTokensLimit),
    purpose: "source_recall",
  };
}

export function sourceRecallFallbackReply(userQuestion = ""): string {
  const compact = userQuestion.replace(/\s+/g, "");
  if (/爱|感情|喜欢|在乎|舍得|放下|柱子/.test(compact)) {
    return "这事我不能拿一句“我在”糊弄你。对柱子，最早是心疼和责任，后来也有放不下的牵挂；再具体的地方，我得按记得准的说，不能乱编。";
  }
  return "这段我不敢乱说。记得准的我会告诉你，记不准的地方，我不能编给你听。";
}

export function isUnhelpfulSourceRecallReply(reply: string): boolean {
  const compact = reply.replace(/\s+/g, "").replace(/[。.!！]+$/g, "");
  return compact === "我在" || compact === "在" || compact === "嗯";
}

export function withSourceGroundingInstruction(baseInstruction: string, sourceContext: string): string {
  if (!sourceContext.trim()) return baseInstruction;

  return [
    baseInstruction,
    "【原文回忆答复约束】本轮已经进入原著证据模式。回答时先在心里核对上方内部证据，只回答用户实际问到的那一点。",
    "如果内部证据没有明确支持某个地点、人物、先后顺序、动作或细节，就说这部分记不准；不要用大致剧情、人物设定、上一轮聊天或常识补编。",
    "回复优先 1-3 句。答完就停，除非用户明确追问，不要顺着继续讲后续剧情，也不要补心理活动和额外情节。",
    "保持角色口吻和私聊感，但不要说“资料库”“证据”“检索结果”。",
  ].filter(Boolean).join("\n\n");
}

export function buildSourceGroundingRewriteMessages(options: SourceGroundingRewriteOptions): LLMMessage[] {
  return [
    {
      role: "system",
      content: [
        `你负责把 ${options.personaName} 的原著回忆回复改写成最终可发送文本。`,
        "你只能依据用户问题和内部证据进行事实核查，不能引入新剧情、新地点、新人物、新顺序或新动作。",
        "如果草稿里有内部证据没有明确支持的具体细节，必须删除，或改成角色自然地说记不准。",
        "最终回复要保持第一人称角色口吻和私聊感；不要说“资料库”“证据”“检索结果”“核查”。",
        "最终回复优先 1-3 句；答完用户问到的点就停，不要继续讲后续剧情。",
        "不要输出括号动作、舞台旁白、项目符号、解释过程或引用格式。",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        "内部证据：",
        options.sourceContext,
        "用户本轮问题：",
        options.userQuestion,
        "待核查草稿：",
        options.draftReply,
        "请只输出最终可发送给用户的回复。若草稿缺乏证据支撑，不要补写，直接改成自然的“不敢乱说/记不准”。",
      ].join("\n\n"),
    },
  ];
}

export async function enforceSourceGroundedReply(options: SourceGroundingRewriteOptions): Promise<string> {
  const fallback = sourceRecallFallbackReply(options.userQuestion);
  const draft = cleanAssistantReply(options.draftReply, fallback);
  if (isUnhelpfulSourceRecallReply(draft)) {
    console.warn("[SourceRecall] source_grounding_unhelpful_draft fallback=source_recall_specific");
    return fallback;
  }
  if (!options.sourceContext.trim() || !draft.trim()) return draft;

  try {
    const economy = options.economyPolicy ?? await getCurrentLlmEconomyPolicy();
    const rewritten = await llmService.invoke({
      messages: buildSourceGroundingRewriteMessages({ ...options, draftReply: draft }),
      options: sourceGroundedLlmOptions(options.llmOptions, economy.sourceRecall.maxRewriteTokens),
    });

    const finalReply = cleanAssistantReply(rewritten, draft);
    if (isUnhelpfulSourceRecallReply(finalReply)) {
      console.warn("[SourceRecall] source_grounding_unhelpful_rewrite fallback=draft");
      return draft;
    }
    return finalReply;
  } catch (err) {
    console.warn("[SourceRecall] source_grounding_rewrite_failed", err);
    return draft;
  }
}
