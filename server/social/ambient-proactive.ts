import { llmService } from "../llm";
import { getCurrentLlmEconomyPolicy } from "../llm/economy";
import {
  createMessage,
  getDefaultLlmConfig,
  getDueFollowUps,
  getMessagesByPersonaId,
  getPersonaById,
  getPinnedMemoryFacts,
  markFollowUpDone,
  updatePersona,
} from "../db";
import { buildSystemPrompt } from "../_core/persona-utils";
import { getEffectiveInnerState } from "../_core/persona-inner-state";
import {
  getProactiveMessageSettings,
  withPersonaRuntimeDiagnostics,
  withProactiveMessageRuntime,
} from "../_core/persona-runtime";
import { cleanAssistantReply, isRepetitiveReply } from "../_core/reply-utils";
import {
  resolveProactivePreferredTarget,
  sendProactiveMessageToPreferredPlatform,
} from "./proactive-delivery";
import { resolveProactiveModality } from "./proactive-multimodal";
import {
  buildProactiveRuntimeDiagnostics,
  buildProactiveRuntimePlan,
  type ProactiveRuntimePlan,
} from "./proactive-runtime";
import {
  buildConversationContinuityInstruction,
  formatRecentConversationTimeline,
} from "./conversation-continuity";
import {
  getBeijingDateKey,
  getBeijingMinuteOfDay,
} from "../_core/time-context";

type AmbientPeriod = "day" | "evening" | "lateNight";

type AmbientPeriodConfig = {
  label: string;
  startMinute: number;
  endMinute: number;
  probability: number;
  minIntervalMs: number;
  targetRange: [number, number];
};

type AmbientPresenceState = {
  date: string;
  counts: Partial<Record<AmbientPeriod, number>>;
  targets: Partial<Record<AmbientPeriod, number>>;
  lastSentAt?: string;
  lastSentByPeriod?: Partial<Record<AmbientPeriod, string>>;
};

const MINUTE = 60_000;
const runningAmbientSends = new Set<string>();

const PERIODS: Record<AmbientPeriod, AmbientPeriodConfig> = {
  day: {
    label: "白天",
    startMinute: 5 * 60,
    endMinute: 18 * 60,
    probability: 0.18,
    minIntervalMs: 90 * MINUTE,
    targetRange: [2, 5],
  },
  evening: {
    label: "晚上",
    startMinute: 18 * 60,
    endMinute: 24 * 60,
    probability: 0.14,
    minIntervalMs: 45 * MINUTE,
    targetRange: [3, 6],
  },
  lateNight: {
    label: "凌晨",
    startMinute: 0,
    endMinute: 5 * 60,
    probability: 0.18,
    minIntervalMs: 120 * MINUTE,
    targetRange: [0, 1],
  },
};

function dateKey(now = new Date()) {
  return getBeijingDateKey(now);
}

function minutesNow(now = new Date()) {
  return getBeijingMinuteOfDay(now);
}

function randomIntInclusive([min, max]: [number, number]) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function getAmbientPeriod(now = new Date()): AmbientPeriod {
  const minute = minutesNow(now);
  if (minute < PERIODS.lateNight.endMinute) return "lateNight";
  if (minute >= PERIODS.evening.startMinute) return "evening";
  return "day";
}

function buildState(raw: unknown, today: string): AmbientPresenceState {
  const state = (raw && typeof raw === "object" ? raw : {}) as Partial<AmbientPresenceState>;
  if (state.date !== today) {
    return {
      date: today,
      counts: {},
      targets: {
        day: randomIntInclusive(PERIODS.day.targetRange),
        evening: randomIntInclusive(PERIODS.evening.targetRange),
        lateNight: randomIntInclusive(PERIODS.lateNight.targetRange),
      },
      lastSentByPeriod: {},
    };
  }

  return {
    date: today,
    counts: state.counts || {},
    targets: {
      day: state.targets?.day ?? randomIntInclusive(PERIODS.day.targetRange),
      evening: state.targets?.evening ?? randomIntInclusive(PERIODS.evening.targetRange),
      lateNight: state.targets?.lateNight ?? randomIntInclusive(PERIODS.lateNight.targetRange),
    },
    lastSentAt: state.lastSentAt,
    lastSentByPeriod: state.lastSentByPeriod || {},
  };
}

function dynamicProbability(period: AmbientPeriod, count: number, target: number, now: Date) {
  if (target <= 0 || count >= target) return 0;

  const config = PERIODS[period];
  const minute = minutesNow(now);
  const progress = Math.max(
    0,
    Math.min(1, (minute - config.startMinute) / Math.max(1, config.endMinute - config.startMinute)),
  );
  const expected = target * progress;

  if (count + 0.75 < expected) return Math.min(0.5, config.probability * 2.2);
  if (count > expected + 0.75) return config.probability * 0.5;
  return config.probability;
}

function tooSoon(lastIso: string | undefined, minIntervalMs: number, now: Date) {
  if (!lastIso) return false;
  const last = new Date(lastIso).getTime();
  if (!Number.isFinite(last)) return false;
  return now.getTime() - last < minIntervalMs;
}

// 兜底句池 + 轮转游标：LLM 失败回退时不要每次都发同一句固定话，按游标错开避免连发重复。
let ambientFallbackCursor = 0;
const AMBIENT_FALLBACK_POOL: Record<"lateNight" | "evening" | "default", string[]> = {
  lateNight: [
    "夜深了，我没想打扰你，只是忽然想到你。早点睡，别一个人胡思乱想。",
    "这会儿夜静，脑子里又转到你身上了。困了就睡，别硬撑。",
    "睡前突然惦记你一下。别熬太晚，盖好被子。",
  ],
  evening: [
    "刚把今天的事收了收，忽然想问你累不累。晚饭要好好吃。",
    "傍晚总算闲下来，第一件事就是想起你。今天还顺吗。",
    "忙完这阵子，心里头就冒出你。别又忘了吃饭。",
  ],
  default: [
    "刚忙完手边的事，短短地想起你一下。记得吃饭，别一忙就忘了照顾自己。",
    "手头刚空下来，脑子一晃就是你。别太累着自己。",
    "中间歇了口气，顺手想问问你这会儿在做什么。",
  ],
};

function fallbackMessage(period: AmbientPeriod) {
  const pool = period === "lateNight"
    ? AMBIENT_FALLBACK_POOL.lateNight
    : period === "evening"
      ? AMBIENT_FALLBACK_POOL.evening
      : AMBIENT_FALLBACK_POOL.default;
  const message = pool[ambientFallbackCursor % pool.length];
  ambientFallbackCursor += 1;
  return message;
}

export type AmbientProactiveMessageResult = {
  replyText: string;
  runtimePlan: ProactiveRuntimePlan;
  inputText: string;
  /** 本条消息用到的到期回访记忆 id；发送成功后据此 markFollowUpDone */
  followUpId: number | null;
};

export async function generateAmbientMessageDetailed(
  persona: any,
  eventText: string,
  period: AmbientPeriod,
  now = new Date(),
): Promise<AmbientProactiveMessageResult> {
  const defaultConfig = await getDefaultLlmConfig(persona.userId);
  const extra = (defaultConfig?.extraConfig as any) || {};
  const proactive = getProactiveMessageSettings(persona.personaData);
  const history = await getMessagesByPersonaId(persona.id, 16);
  const target = await resolveProactivePreferredTarget(persona);
  const inputText = `环境主动消息 ${PERIODS[period].label}: ${eventText}`;
  const runtimePlan = buildProactiveRuntimePlan({
    target,
    inputText,
    recentMessages: history.slice(-12),
    personaData: persona.personaData,
    now,
  });
  const recentContext = formatRecentConversationTimeline(history, persona.name, 10);
  const continuityInstruction = buildConversationContinuityInstruction(history, persona.name, "proactive");
  let pinnedFacts: string[] = [];
  try {
    pinnedFacts = await getPinnedMemoryFacts(persona.id, persona.userId);
  } catch {
    pinnedFacts = [];
  }
  // 到期的关心回访：让这条主动消息自然问起用户之前提过、现在该有结果的事。
  let followUp: { id: number; title: string } | null = null;
  try {
    const due = await getDueFollowUps(persona.id, persona.userId, now, 1);
    followUp = due[0] ? { id: due[0].id, title: due[0].title } : null;
  } catch {
    followUp = null;
  }
  // 人物「自己今天」的状态，给主动消息一个由头（而非纯寒暄）。
  const innerState = getEffectiveInnerState(persona.personaData, persona.id, now);

  const response = await llmService.invoke({
    messages: [
      {
        role: "system",
        content: [
          buildSystemPrompt(persona, {
            now,
            pinnedFacts,
            innerState,
          }),
          runtimePlan.instruction,
        ].filter(Boolean).join("\n\n"),
      },
      {
        role: "user",
        content: [
          `计划投递入口：${runtimePlan.platform} / ${runtimePlan.channel}。`,
          `现在是${PERIODS[period].label}，网页里刚触发了一个日常存在感事件：“${eventText}”。`,
          "这次事件抽中了主动私聊消息。请把这个动作或心情转成角色本人会发给用户的一条自然私聊。",
          "要求：内容要和当下动作/心情有关，不要提到网页、事件、触发、概率、系统或定时。",
          "不要写括号动作/旁白，不要剧本格式，30 到 80 个中文字符。",
          "只写此刻真实的动作和心情；可以自然带出你背景里真实的感受，但不要凭空虚构你和对方过去的具体共同经历（如「头一回给你做某事」「当年我们在某地怎样」这类并未确立的往事），没把握的旧事宁可不提、也不要编。",
          "必须延续最近对话里的时间线和空间状态；不要重复刚说过的话，不要和最近说过的行程矛盾。",
          "如果最近已经说过到所里、正在看地图或已经下班，就不要再说正要去所里；如果用户刚纠正异地，就必须按武汉-南京异地来写。",
          continuityInstruction,
          "如果上一条消息用户没回，优先沿着上一条的关心点轻轻跟进，不要另起一个相似寒暄。",
          innerState.dayContext?.note ? `你今天的状态：${innerState.dayContext.note}。可以让这点自然影响语气，偶尔顺口提一句自己今天，但别长篇、别报流水账。` : "",
          followUp ? `你之前一直惦记着一件事：「${followUp.title}」。如果自然，可以在这条消息里关心地顺口问一句它后来怎么样了，别生硬、别像查岗，问过一次就够。` : "",
          recentContext ? `最近对话上下文：\n${recentContext}` : "",
          proactive.stylePrompt ? `主动消息风格补充：${proactive.stylePrompt}` : "",
        ].filter(Boolean).join("\n"),
      },
    ],
    options: {
      provider: (persona as any).llmProvider || undefined,
      temperature: Math.max(extra.temperature ?? 0.85, 0.85),
      maxTokens: Math.min(extra.maxTokens ?? 240, 360),
      purpose: "proactive",
      userId: persona.userId,
      personaId: persona.id,
      route: `proactive.${runtimePlan.platform}.ambient`,
    },
  });

  // 主动消息复读兜底：生成内容为空、或与最近几条 assistant 回复高度雷同时，改用错开的兜底句池，避免反复发同样的话。
  // fallbackMessage 仅在真正需要兜底时调用一次（游标只在使用时前进），happy path 不空转游标。
  const priorAssistant = history.filter(message => message.role === "assistant").slice(-5).map(message => message.content);
  const cleaned = cleanAssistantReply(response, "");
  const replyText = (!cleaned || (priorAssistant.length > 0 && isRepetitiveReply(cleaned, priorAssistant)))
    ? fallbackMessage(period)
    : cleaned;

  return {
    replyText,
    runtimePlan,
    inputText,
    followUpId: followUp?.id ?? null,
  };
}

export async function generateAmbientMessage(persona: any, eventText: string, period: AmbientPeriod): Promise<string> {
  const result = await generateAmbientMessageDetailed(persona, eventText, period);
  return result.replyText;
}

export async function maybeSendAmbientPresenceMessage(
  personaId: number,
  userId: number,
  eventText: string,
  options: { force?: boolean } = {},
) {
  const lockKey = `${userId}:${personaId}`;
  if (runningAmbientSends.has(lockKey)) {
    return { sent: false, reason: "already_running" as const };
  }
  runningAmbientSends.add(lockKey);

  try {
  const now = new Date();
  const period = getAmbientPeriod(now);
  const today = dateKey(now);
  const config = PERIODS[period];

  const persona = await getPersonaById(personaId, userId);
  if (!persona || persona.analysisStatus !== "ready") {
    return { sent: false, reason: "persona_not_ready" as const };
  }

  const personaData = ((persona.personaData as any) || {});
  const proactive = getProactiveMessageSettings(personaData);
  if (!proactive.enabled) return { sent: false, reason: "disabled" as const };

  const economy = await getCurrentLlmEconomyPolicy(now);
  if (!options.force && !economy.proactive.allowAmbient) {
    return {
      sent: false,
      reason: "llm_budget" as const,
      period,
      economyLevel: economy.level,
    };
  }

  const state = buildState(proactive.ambientPresence, today);
  const count = state.counts[period] || 0;
  const target = state.targets[period] ?? randomIntInclusive(config.targetRange);

  if (!options.force && count >= target) return { sent: false, reason: "daily_target_reached" as const, period, count, target };
  if (!options.force && tooSoon(state.lastSentByPeriod?.[period], config.minIntervalMs, now)) {
    return { sent: false, reason: "too_soon" as const, period, count, target };
  }

  const probability = dynamicProbability(period, count, target, now);
  if (!options.force && Math.random() > probability) {
    return { sent: false, reason: "probability_skip" as const, period, count, target, probability };
  }

  const generated = await generateAmbientMessageDetailed(persona, eventText, period, now);
  const replyText = generated.replyText;
  // 主动多模态：开关开启时按概率走语音/表情，关闭时恒为文本（resolveProactiveModality 内部门控）。
  const modality = resolveProactiveModality();
  const delivery = await sendProactiveMessageToPreferredPlatform(persona, replyText, modality);
  if (!delivery.sent) {
    return { sent: false, reason: delivery.reason || "send_failed", period, count, target };
  }

  // 已经主动问起的回访，清掉到期标记，避免反复追问同一件事。
  if (generated.followUpId) {
    try {
      await markFollowUpDone(generated.followUpId, persona.userId);
    } catch (err) {
      console.warn(`[AmbientProactive] markFollowUpDone failed persona=${persona.id}:`, err);
    }
  }

  const nextState: AmbientPresenceState = {
    ...state,
    counts: {
      ...state.counts,
      [period]: count + 1,
    },
    lastSentAt: now.toISOString(),
    lastSentByPeriod: {
      ...state.lastSentByPeriod,
      [period]: now.toISOString(),
    },
  };

  await createMessage({
    personaId: persona.id,
    userId: persona.userId,
    role: "assistant",
    content: replyText,
    emotionalState: persona.emotionalState,
    channel: delivery.channel,
  });

  await updatePersona(persona.id, persona.userId, {
    personaData: withPersonaRuntimeDiagnostics(
      withProactiveMessageRuntime(personaData, { ambientPresence: nextState }),
      buildProactiveRuntimeDiagnostics({
        runtimePlan: generated.runtimePlan,
        trigger: "ambient",
        inputText: generated.inputText,
        replyText,
        delivery,
        now,
        details: {
          eventText,
          period,
          ambientPresence: nextState,
          // 记录本条实际发出的模态（语音/表情失败会回退文本，这里取实际发送结果）。
          multimodalIntent: delivery.modality ?? modality,
        },
      }),
    ),
    lastChatAt: now,
  });

  console.log(`[AmbientProactive] Sent ${period} ${delivery.platform} message for persona ${persona.name} (${persona.id})`);
  return { sent: true, period, count: count + 1, target, platform: delivery.platform };
  } finally {
    runningAmbientSends.delete(lockKey);
  }
}
