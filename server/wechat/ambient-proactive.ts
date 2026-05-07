import { llmService } from "../llm";
import {
  createMessage,
  getActiveWechatBindingsByPersonaId,
  getDefaultLlmConfig,
  getPersonaById,
  updatePersona,
} from "../db";
import { buildSystemPrompt } from "../_core/persona-utils";
import { stripLeadingAsides } from "../_core/reply-utils";
import { getBotStatus, sendWeChatText } from "./bot";

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
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function minutesNow(now = new Date()) {
  return now.getHours() * 60 + now.getMinutes();
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

function fallbackMessage(period: AmbientPeriod) {
  if (period === "lateNight") {
    return "夜深了，我没想打扰你，只是忽然想到你。早点睡，别一个人胡思乱想。";
  }
  if (period === "evening") {
    return "刚把今天的事收了收，忽然想问你累不累。晚饭要好好吃。";
  }
  return "刚忙完手边的事，短短地想起你一下。记得吃饭，别一忙就忘了照顾自己。";
}

async function generateAmbientMessage(persona: any, eventText: string, period: AmbientPeriod) {
  const defaultConfig = await getDefaultLlmConfig(persona.userId);
  const extra = (defaultConfig?.extraConfig as any) || {};
  const proactive = (((persona.personaData as any) || {}).proactiveMessages || {}) as any;

  const response = await llmService.invoke({
    messages: [
      { role: "system", content: buildSystemPrompt(persona) },
      {
        role: "user",
        content: [
          `现在是${PERIODS[period].label}，网页里刚触发了一个日常存在感事件：“${eventText}”。`,
          "这次事件抽中了主动微信消息。请把这个动作或心情转成角色本人会发给用户的一条自然私聊。",
          "要求：内容要和当下动作/心情有关，不要提到网页、事件、触发、概率、系统或定时。",
          "不要写括号动作/旁白，不要剧本格式，30 到 80 个中文字符。",
          proactive.stylePrompt ? `主动消息风格补充：${proactive.stylePrompt}` : "",
        ].filter(Boolean).join("\n"),
      },
    ],
    options: {
      provider: (persona as any).llmProvider || undefined,
      temperature: Math.max(extra.temperature ?? 0.85, 0.85),
      maxTokens: Math.min(extra.maxTokens ?? 240, 360),
    },
  });

  return stripLeadingAsides(response || fallbackMessage(period));
}

export async function maybeSendAmbientPresenceMessage(
  personaId: number,
  userId: number,
  eventText: string,
  options: { force?: boolean } = {},
) {
  const now = new Date();
  const period = getAmbientPeriod(now);
  const today = dateKey(now);
  const config = PERIODS[period];

  const persona = await getPersonaById(personaId, userId);
  if (!persona || persona.analysisStatus !== "ready") {
    return { sent: false, reason: "persona_not_ready" as const };
  }

  const personaData = ((persona.personaData as any) || {});
  const proactive = personaData.proactiveMessages || {};
  if (!proactive.enabled) return { sent: false, reason: "disabled" as const };
  if (getBotStatus().status !== "logged_in") return { sent: false, reason: "wechat_offline" as const };

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

  const bindings = await getActiveWechatBindingsByPersonaId(persona.id, persona.userId);
  if (bindings.length === 0) return { sent: false, reason: "no_binding" as const, period, count, target };

  const replyText = await generateAmbientMessage(persona, eventText, period);
  let sent = false;
  for (const binding of bindings) {
    sent = (await sendWeChatText(binding.wechatContactId, replyText, binding.wechatName)) || sent;
  }
  if (!sent) return { sent: false, reason: "send_failed" as const, period, count, target };

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
    channel: "wechat",
  });

  await updatePersona(persona.id, persona.userId, {
    personaData: {
      ...personaData,
      proactiveMessages: {
        ...proactive,
        ambientPresence: nextState,
      },
    },
    lastChatAt: now,
  });

  console.log(`[AmbientProactive] Sent ${period} message for persona ${persona.name} (${persona.id})`);
  return { sent: true, period, count: count + 1, target };
}
