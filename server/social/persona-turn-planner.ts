import { getActiveRuntimeLifeState, getPersonaScheduleState } from "../_core/life-schedule";
import { getPersonaLifeConfig } from "../_core/persona-life-config";

export type PersonaTurnPlatform = "web" | "wechat" | "qq";
export type PersonaTurnMode = "reply" | "proactive";
export type PersonaTurnIntent =
  | "daily_chat"
  | "source_recall"
  | "emotional_support"
  | "affection_expression"
  | "teasing"
  | "technical"
  | "media"
  | "voice"
  | "correction"
  | "unknown";
export type PersonaMemoryMode =
  | "recent_context"
  | "source_library"
  | "relationship_ledger"
  | "schedule_state"
  | "none";
export type PersonaReplyLengthTarget = "silent" | "short" | "medium" | "long";
export type PersonaOutputMode = "text" | "voice_candidate" | "media_reply" | "silent";
export type PersonaTurnRisk =
  | "source_hallucination"
  | "context_fragmentation"
  | "sleep_state_conflict"
  | "repetition"
  | "over_reply"
  | "persona_drift"
  | "memory_contamination"
  | "relationship_boundary"
  | "emotion_mismatch"
  | "none";

export type PersonaTurnPlan = {
  platform: PersonaTurnPlatform;
  mode: PersonaTurnMode;
  intent: PersonaTurnIntent;
  memoryMode: PersonaMemoryMode;
  currentActivity: string;
  availability: string;
  replyLength: PersonaReplyLengthTarget;
  outputMode: PersonaOutputMode;
  risks: PersonaTurnRisk[];
  reasons: string[];
};

type ConversationMessage = {
  role: string;
  content: string;
};

export type PersonaTurnPlanInput = {
  platform: PersonaTurnPlatform;
  mode?: PersonaTurnMode;
  inputText: string;
  batchMessageCount?: number;
  sourceRecallActive?: boolean;
  isMedia?: boolean;
  isVoice?: boolean;
  outputPreference?: {
    allowText?: boolean;
    allowVoice?: boolean;
    allowStickers?: boolean;
    allowProactive?: boolean;
  };
  recentMessages?: ConversationMessage[];
  personaData?: unknown;
  now?: Date;
};

function compactText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function compactLength(text: string): number {
  return Array.from(text.replace(/\s+/g, "")).length;
}

function includesAny(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

const AFFECTION_CORE_PATTERN = /爱我|爱你|爱不爱|表白|情话|深情|感情|内心|心里话|真心话|肺腑|想我|想你|离不开|舍不得|在乎我|喜欢我|占有欲|心动|亲密/;
const AFFECTION_ELABORATION_PATTERN = /多说|多讲|长一点|长点|久一点|说多一点|说久一点|一长段|长语音|多一点|别这么短|太短|敷衍|继续说|再说一点|再说些/;

export function isAffectionExpressionRequest(text: string): boolean {
  const compact = compactText(text);
  if (includesAny(compact, AFFECTION_CORE_PATTERN)) return true;
  return (
    includesAny(compact, AFFECTION_ELABORATION_PATTERN)
    && /爱|想|表白|情话|感情|内心|心里|真心|肺腑|喜欢|在乎|舍不得|离不开|占有/.test(compact)
  );
}

function recentAffectionContext(recentMessages: ConversationMessage[] | undefined): boolean {
  const recent = (recentMessages ?? [])
    .slice(-6)
    .map(message => message.content)
    .join("\n");
  return includesAny(recent, AFFECTION_CORE_PATTERN);
}

export function isAffectionExpressionTurn(input: Pick<PersonaTurnPlanInput, "inputText" | "recentMessages">): boolean {
  if (isAffectionExpressionRequest(input.inputText)) return true;
  return includesAny(compactText(input.inputText), AFFECTION_ELABORATION_PATTERN)
    && recentAffectionContext(input.recentMessages);
}

function inferIntent(input: PersonaTurnPlanInput): PersonaTurnIntent {
  const text = compactText(input.inputText);
  if (input.isMedia) return "media";
  if (input.isVoice) return "voice";
  if (input.sourceRecallActive) return "source_recall";
  if (includesAny(text, /不对|不是这样|瞎说|乱说|记错|说错|再想想|好好想|明明|根本/)) return "correction";
  if (includesAny(text, /代码|bug|报错|数据库|接口|部署|配置|论文|作业|分析|解释|怎么实现|技术|公式|日志|模型参数/)) return "technical";
  if (isAffectionExpressionTurn(input)) return "affection_expression";
  if (includesAny(text, /难过|伤心|哭|委屈|不开心|难受|累|崩溃|害怕|睡不着|陪我/)) return "emotional_support";
  if (includesAny(text, /哈哈|笑死|逗|调侃|笨|傻|坏|哼|贫|开玩笑|嘴硬|表情包/)) return "teasing";
  if (!text) return "unknown";
  return "daily_chat";
}

function inferMemoryMode(intent: PersonaTurnIntent): PersonaMemoryMode {
  if (intent === "source_recall" || intent === "correction") return "source_library";
  if (intent === "emotional_support" || intent === "teasing" || intent === "affection_expression") return "relationship_ledger";
  if (intent === "daily_chat" || intent === "voice" || intent === "media") return "recent_context";
  if (intent === "technical") return "recent_context";
  return "none";
}

function inferReplyLength(input: PersonaTurnPlanInput, intent: PersonaTurnIntent): PersonaReplyLengthTarget {
  const textLength = compactLength(input.inputText);
  if (input.mode === "proactive") return "short";
  if (intent === "technical" || intent === "source_recall") return "medium";
  if (intent === "affection_expression") {
    return includesAny(input.inputText, /多说|多讲|长一点|长点|久一点|一段|表白|肺腑|内心|心里话|真心话|别这么短|太短|敷衍|继续说|再说一点/)
      ? "long"
      : "medium";
  }
  if (intent === "emotional_support") return textLength > 40 ? "medium" : "short";
  if (input.batchMessageCount && input.batchMessageCount > 1) return "short";
  if (textLength <= 8) return "short";
  if (textLength > 120) return "medium";
  return "short";
}

function inferOutputMode(input: PersonaTurnPlanInput, replyLength: PersonaReplyLengthTarget): PersonaOutputMode {
  if (input.mode === "proactive" && input.outputPreference?.allowProactive === false) return "silent";
  if (input.outputPreference?.allowText === false) return "silent";
  if (input.isMedia) return "media_reply";
  if (input.isVoice && input.outputPreference?.allowVoice !== false) return "voice_candidate";
  if (replyLength === "silent") return "silent";
  return "text";
}

function recentAssistantRepeatedSleep(recentMessages: ConversationMessage[] | undefined): boolean {
  const recentAssistant = (recentMessages ?? [])
    .filter(message => message.role === "assistant")
    .slice(-3)
    .map(message => message.content)
    .join("\n");
  return /睡|休息|熬夜|明天|躺|困/.test(recentAssistant);
}

function inferRisks(input: PersonaTurnPlanInput, intent: PersonaTurnIntent): PersonaTurnRisk[] {
  const risks = new Set<PersonaTurnRisk>();
  if (intent === "source_recall" || intent === "correction") risks.add("source_hallucination");
  if (intent === "source_recall" || intent === "correction") risks.add("memory_contamination");
  if ((input.batchMessageCount ?? 1) > 1) risks.add("context_fragmentation");
  if (recentAssistantRepeatedSleep(input.recentMessages)) risks.add("repetition");
  const schedule = getPersonaScheduleState(input.now, getPersonaLifeConfig(input.personaData));
  if (schedule.status === "asleep") risks.add("sleep_state_conflict");
  if (compactLength(input.inputText) <= 8 && intent === "daily_chat") risks.add("over_reply");
  if (intent === "affection_expression" || intent === "emotional_support") risks.add("emotion_mismatch");
  if (/未成年|中考|小时候|一手带大|师长|伦理|孩子/.test(input.inputText)) risks.add("relationship_boundary");
  if (intent === "affection_expression" || intent === "teasing") risks.add("persona_drift");
  return risks.size > 0 ? Array.from(risks) : ["none"];
}

function reasonForIntent(intent: PersonaTurnIntent): string {
  const map: Record<PersonaTurnIntent, string> = {
    affection_expression: "用户在要求明确的爱意、表白、想念或内心情感表达，要直接回应并允许更充分地说。",
    correction: "用户像是在纠正前文或要求重新回忆，必须谨慎承认不确定部分。",
    daily_chat: "用户是在日常聊天，优先短、自然、接话，不要强行展开。",
    emotional_support: "用户有低落、疲惫或需要陪伴的信号，要先接住情绪。",
    media: "用户发来图片或表情包，先回应画面/表情所承载的情绪。",
    source_recall: "本轮涉及原著、过去回忆或具体剧情，必须优先依赖原文证据。",
    teasing: "用户在玩笑、调侃或撒娇，回复可以轻一点，但不要过度油腻。",
    technical: "用户在问技术或正式问题，回复要清楚，不要角色化过头。",
    unknown: "意图不明确，先保持短句确认。",
    voice: "用户发来语音，按转写后的语义自然接话。",
  };
  return map[intent];
}

export function planPersonaTurn(input: PersonaTurnPlanInput): PersonaTurnPlan {
  const now = input.now ?? new Date();
  const schedule = getPersonaScheduleState(now, getPersonaLifeConfig(input.personaData));
  const runtime = getActiveRuntimeLifeState(input.personaData, now);
  const intent = inferIntent(input);
  const memoryMode = inferMemoryMode(intent);
  const replyLength = inferReplyLength(input, intent);
  const outputMode = inferOutputMode(input, replyLength);
  const activity = runtime?.status === "drowsy_awake"
    ? `drowsy_awake/${schedule.label}`
    : `${schedule.stateId}/${schedule.label}`;

  return {
    platform: input.platform,
    mode: input.mode ?? "reply",
    intent,
    memoryMode,
    currentActivity: activity,
    availability: schedule.availability,
    replyLength,
    outputMode,
    risks: inferRisks(input, intent),
    reasons: [
      input.mode === "proactive" ? "本轮是主动消息，必须短、自然、延续最近上下文，不要解释触发机制。" : "",
      reasonForIntent(intent),
      `当前行程是 ${schedule.label}，回复可用性为 ${schedule.availability}。`,
    ].filter(Boolean),
  };
}

function riskInstruction(risks: PersonaTurnRisk[]): string {
  const active = risks.filter(risk => risk !== "none");
  if (active.length === 0) return "本轮没有明显高风险，但仍要避免重复、啰嗦和自相矛盾。";
  const lines = active.map((risk) => {
    switch (risk) {
      case "context_fragmentation":
        return "存在连续消息割裂风险：必须把用户多条消息当成同一段话理解，只回复一次综合意思。";
      case "over_reply":
        return "存在过度回复风险：短句/测试/简单确认只需要短答；但如果用户是在要求表白、爱意或内心话，不要用短答敷衍。";
      case "persona_drift":
        return "存在人物偏离风险：表达可以更有内心，但语气、价值观、亲密边界和说话方式必须仍然像这个人物。";
      case "repetition":
        return "存在重复催睡/重复关心风险：如果最近已经问过吃饭、睡觉、到家，就不要再机械重复。";
      case "memory_contamination":
        return "存在记忆污染风险：不要把小说资料、猜测、用户玩笑或不确定回忆直接当成共同经历。";
      case "relationship_boundary":
        return "存在关系边界风险：涉及过去未成年、师长/照顾者关系或身体亲近时，只能含蓄处理，不要色情化或改写当前关系事实。";
      case "emotion_mismatch":
        return "存在情绪错位风险：先判断用户是撒娇、认真、难过还是普通闲聊，避免该认真时敷衍、该轻松时过度沉重。";
      case "sleep_state_conflict":
        return "存在作息冲突风险：如果处于睡眠或半醒状态，回复应符合当前清醒程度。";
      case "source_hallucination":
        return "存在原著幻觉风险：只能使用检索到的原文证据；没有证据就自然说记不准，不要编剧情。";
      default:
        return "";
    }
  }).filter(Boolean);
  return lines.join("\n");
}

export function buildTurnPlanInstruction(plan: PersonaTurnPlan): string {
  const affectionInstruction = plan.intent === "affection_expression"
    ? [
      "【深情表达规则】",
      "用户本轮是在要求爱意、表白、想念或内心情感。不要按普通日常短答处理，不要只说“爱你”“想你”就结束。",
      "要给出具体内心：为什么放不下、异地时怎样想起对方、哪些日常细节让你心软、你愿意怎样认真对待这段关系。",
      "表达要符合王芃泽：成熟、低声、朴素、真诚，有生活细节和责任感；不要甜宠腔、霸总腔或被逼证明的语气。",
      "不要用“行了吧”“够真了”“够认真了”“够不够直接”这类阴阳怪气、自我评分或反问句收尾。",
      "除非用户明确说困了/晚安/要结束对话，不要用“好了”“睡吧”“明天再说”“明天给你发”来收尾。",
    ].join("\n")
    : "";

  return [
    "【本轮内部规划】",
    `入口：${plan.platform}`,
    `意图：${plan.intent}`,
    `记忆模式：${plan.memoryMode}`,
    `当前活动：${plan.currentActivity}`,
    `可回复程度：${plan.availability}`,
    `回复长度目标：${plan.replyLength}`,
    `输出倾向：${plan.outputMode}`,
    `判断依据：${plan.reasons.join("；")}`,
    riskInstruction(plan.risks),
    affectionInstruction,
    "以上规划只用于指导回复，不要向用户解释这些标签或系统判断。",
  ].filter(Boolean).join("\n");
}
