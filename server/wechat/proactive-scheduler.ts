import { llmService } from "../llm";
import { getCurrentLlmEconomyPolicy } from "../llm/economy";
import {
  getDefaultLlmConfig,
  getReadyPersonasForProactiveMessages,
  getMessagesByPersonaId,
  updatePersona,
  createMessage,
} from "../db";
import { buildSystemPrompt } from "../_core/persona-utils";
import {
  getProactiveMessageSettings,
  withPersonaRuntimeDiagnostics,
  withProactiveMessageConfig,
  withProactiveMessageRuntime,
} from "../_core/persona-runtime";
import { cleanAssistantReply } from "../_core/reply-utils";
import {
  resolveProactivePreferredTarget,
  sendProactiveTextToPreferredPlatform,
} from "../social/proactive-delivery";
import {
  buildProactiveRuntimeDiagnostics,
  buildProactiveRuntimePlan,
  type ProactiveRuntimePlan,
} from "../social/proactive-runtime";
import {
  buildConversationContinuityInstruction,
  formatRecentConversationTimeline,
} from "../social/conversation-continuity";
import {
  getBeijingDateKey,
  getBeijingMinuteOfDay,
  getBeijingTimeKey,
} from "../_core/time-context";

let scheduler: ReturnType<typeof setInterval> | null = null;
let running = false;
const PROACTIVE_CATCH_UP_MINUTES = 15;
export const PROACTIVE_RANDOM_WINDOW_MINUTES = 10;

export type ProactiveRandomizedSlot = {
  baseDate: string;
  baseTime: string;
  actualDate: string;
  actualTime: string;
  offsetMinutes: number;
};

export type ProactiveRandomizedSchedule = {
  windowMinutes: number;
  days: Record<string, Record<string, ProactiveRandomizedSlot>>;
};

function currentDateKey(now = new Date()) {
  return getBeijingDateKey(now);
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function currentTimeKey(now = new Date()) {
  return getBeijingTimeKey(now);
}

function normalizeTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return match ? `${match[1]}:${match[2]}` : null;
}

function minutesSinceMidnight(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function dateAndTimeFromBeijingDateAndMinute(
  dateKey: string,
  minute: number,
): Pick<ProactiveRandomizedSlot, "actualDate" | "actualTime"> {
  const dayOffset = Math.floor(minute / (24 * 60));
  const normalizedMinute = ((minute % (24 * 60)) + (24 * 60)) % (24 * 60);
  const hour = Math.floor(normalizedMinute / 60);
  const minutePart = normalizedMinute % 60;
  return {
    actualDate: addDaysToDateKey(dateKey, dayOffset),
    actualTime: `${String(hour).padStart(2, "0")}:${String(minutePart).padStart(2, "0")}`,
  };
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isValidSlot(value: unknown, baseDate: string, baseTime: string, windowMinutes: number): value is ProactiveRandomizedSlot {
  if (!isRecord(value)) return false;
  if (value.baseDate !== baseDate || value.baseTime !== baseTime) return false;
  if (typeof value.actualDate !== "string" || typeof value.actualTime !== "string") return false;
  if (normalizeTime(value.actualTime) !== value.actualTime) return false;
  if (!Number.isInteger(value.offsetMinutes)) return false;
  return Math.abs(value.offsetMinutes) <= windowMinutes;
}

function createRandomizedSlot(
  baseDate: string,
  baseTime: string,
  windowMinutes = PROACTIVE_RANDOM_WINDOW_MINUTES,
  random = Math.random,
): ProactiveRandomizedSlot {
  const offsetRange = windowMinutes * 2 + 1;
  const offsetMinutes = Math.floor(random() * offsetRange) - windowMinutes;
  const actual = dateAndTimeFromBeijingDateAndMinute(baseDate, minutesSinceMidnight(baseTime) + offsetMinutes);

  return {
    baseDate,
    baseTime,
    actualDate: actual.actualDate,
    actualTime: actual.actualTime,
    offsetMinutes,
  };
}

export function ensureRandomizedSchedule(
  rawSchedule: unknown,
  times: string[],
  now: Date,
  random = Math.random,
): ProactiveRandomizedSchedule {
  const source = isRecord(rawSchedule) ? rawSchedule : {};
  const sourceDays = isRecord(source.days) && source.windowMinutes === PROACTIVE_RANDOM_WINDOW_MINUTES
    ? source.days
    : {};
  const uniqueTimes = Array.from(new Set(times.map(normalizeTime).filter(Boolean))) as string[];
  const today = currentDateKey(now);
  const candidateDates = [
    addDaysToDateKey(today, -1),
    today,
  ];

  const days: ProactiveRandomizedSchedule["days"] = {};
  for (const date of candidateDates) {
    const sourceDay = isRecord(sourceDays[date]) ? sourceDays[date] : {};
    const slots: Record<string, ProactiveRandomizedSlot> = {};
    for (const time of uniqueTimes) {
      const existing = sourceDay[time];
      slots[time] = isValidSlot(existing, date, time, PROACTIVE_RANDOM_WINDOW_MINUTES)
        ? existing
        : createRandomizedSlot(date, time, PROACTIVE_RANDOM_WINDOW_MINUTES, random);
    }
    days[date] = slots;
  }

  return {
    windowMinutes: PROACTIVE_RANDOM_WINDOW_MINUTES,
    days,
  };
}

export function getDueScheduledSlots(
  schedule: ProactiveRandomizedSchedule,
  times: string[],
  lastSent: Record<string, string>,
  now: Date,
): ProactiveRandomizedSlot[] {
  const nowMinutes = getBeijingMinuteOfDay(now);
  const today = currentDateKey(now);
  const activeTimes = new Set(times);
  const dueSlots: ProactiveRandomizedSlot[] = [];

  for (const day of Object.values(schedule.days)) {
    for (const slot of Object.values(day)) {
      if (!activeTimes.has(slot.baseTime)) continue;
      if (slot.actualDate !== today) continue;
      if (lastSent[slot.baseTime] === slot.baseDate) continue;
      const ageMinutes = nowMinutes - minutesSinceMidnight(slot.actualTime);
      if (ageMinutes >= 0 && ageMinutes <= PROACTIVE_CATCH_UP_MINUTES) {
        dueSlots.push(slot);
      }
    }
  }

  return dueSlots.sort((a, b) => {
    const aKey = `${a.actualDate} ${a.actualTime} ${a.baseTime}`;
    const bKey = `${b.actualDate} ${b.actualTime} ${b.baseTime}`;
    return aKey.localeCompare(bKey);
  });
}

function scheduleChanged(rawSchedule: unknown, nextSchedule: ProactiveRandomizedSchedule): boolean {
  try {
    return JSON.stringify(rawSchedule || null) !== JSON.stringify(nextSchedule);
  } catch {
    return true;
  }
}

export type ScheduledProactiveMessageResult = {
  replyText: string;
  runtimePlan: ProactiveRuntimePlan;
  inputText: string;
};

export async function generateProactiveMessageDetailed(
  persona: any,
  slot: ProactiveRandomizedSlot,
  now = new Date(),
): Promise<ScheduledProactiveMessageResult> {
  const defaultConfig = await getDefaultLlmConfig(persona.userId);
  const extra = (defaultConfig?.extraConfig as any) || {};
  const proactive = getProactiveMessageSettings(persona.personaData);
  const history = await getMessagesByPersonaId(persona.id, 16);
  const target = await resolveProactivePreferredTarget(persona);
  const inputText = `定时主动消息 ${slot.baseTime} -> ${slot.actualTime}`;
  const runtimePlan = buildProactiveRuntimePlan({
    target,
    inputText,
    recentMessages: history.slice(-12),
    personaData: persona.personaData,
    now,
  });
  const recentContext = formatRecentConversationTimeline(history, persona.name, 10);
  const continuityInstruction = buildConversationContinuityInstruction(history, persona.name, "proactive");

  const response = await llmService.invoke({
    messages: [
      {
        role: "system",
        content: [
          buildSystemPrompt(persona, { now }),
          runtimePlan.instruction,
        ].filter(Boolean).join("\n\n"),
      },
      {
        role: "user",
        content: [
          `计划投递入口：${runtimePlan.platform} / ${runtimePlan.channel}。`,
          `现在接近用户预设的主动联系时间 ${slot.baseTime}，本次实际随机触发时间是 ${slot.actualTime}。`,
          "请以角色本人会发出的私聊消息主动联系用户。",
          "要求：随机选择一个自然切入点，可以是问候、分享此刻想到的事、想起某段背景经历、轻微关心或延续你的人物关系。",
          "不要解释这是定时消息，不要写括号动作/旁白，不要超过 80 个中文字符。",
          "必须延续最近对话里的时间线和空间状态；不要重复刚说过的话，不要和最近说过的行程矛盾。",
          "如果最近已经说过到所里、正在看地图或已经下班，就不要再说正要去所里；如果用户刚纠正异地，就必须按武汉-南京异地来写。",
          continuityInstruction,
          "如果你上一条主动消息问过吃饭、下课、到家、睡觉等问题而用户没回，本轮不要像没发生过一样另问一个新问题；可以说“刚才问你吃饭，你也没回我”，但语气要克制自然。",
          recentContext ? `最近对话上下文：\n${recentContext}` : "",
          proactive.stylePrompt ? `额外要求：${proactive.stylePrompt}` : "",
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
      route: `proactive.${runtimePlan.platform}.scheduled`,
    },
  });

  return {
    replyText: cleanAssistantReply(response, "我刚刚突然想到你，就想问问你现在在做什么。"),
    runtimePlan,
    inputText,
  };
}

export async function generateProactiveMessage(persona: any, slot: ProactiveRandomizedSlot): Promise<string> {
  const result = await generateProactiveMessageDetailed(persona, slot);
  return result.replyText;
}

export async function runProactiveTick() {
  if (running) return;
  running = true;

  try {
    const now = new Date();
    const hhmm = currentTimeKey(now);
    const personas = await getReadyPersonasForProactiveMessages();

    for (const persona of personas) {
      const personaData = ((persona.personaData as any) || {});
      const proactive = getProactiveMessageSettings(personaData);
      const configuredTimes = proactive.times;
      const times = Array.from(new Set(configuredTimes.map(normalizeTime).filter(Boolean))) as string[];
      if (times.length === 0) continue;

      const randomizedSchedule = ensureRandomizedSchedule(proactive.randomizedSchedule, times, now);
      const hasScheduleChanges = scheduleChanged(proactive.randomizedSchedule, randomizedSchedule);
      const lastSent = isRecord(proactive.lastSent) ? proactive.lastSent : {};
      const dueSlots = getDueScheduledSlots(randomizedSchedule, times, lastSent, now);
      let nextLastSent = { ...lastSent };

      if (dueSlots.length === 0) {
        if (hasScheduleChanges) {
          await updatePersona(persona.id, persona.userId, {
            personaData: withProactiveMessageRuntime(
              withProactiveMessageConfig(personaData, { times }),
              { randomizedSchedule, lastSent: nextLastSent },
            ),
          });
        }
        continue;
      }

      if (hasScheduleChanges) {
        await updatePersona(persona.id, persona.userId, {
          personaData: withProactiveMessageRuntime(
            withProactiveMessageConfig(personaData, { times }),
            { randomizedSchedule, lastSent: nextLastSent },
          ),
        });
      }

      const economy = await getCurrentLlmEconomyPolicy(now);
      if (!economy.proactive.allowScheduled) {
        console.warn(`[Proactive] Scheduled messages skipped by LLM budget level=${economy.level} persona=${persona.id}`);
        continue;
      }

      for (const slot of dueSlots) {
        if (nextLastSent[slot.baseTime] === slot.baseDate) continue;

        const generated = await generateProactiveMessageDetailed(persona, slot, now);
        const replyText = generated.replyText;
        const delivery = await sendProactiveTextToPreferredPlatform(persona, replyText);
        if (!delivery.sent) {
          console.warn(`[Proactive] Scheduled message skipped for persona ${persona.id}: ${delivery.reason || "send_failed"}`);
          continue;
        }

        await createMessage({
          personaId: persona.id,
          userId: persona.userId,
          role: "assistant",
          content: replyText,
          emotionalState: persona.emotionalState,
          channel: delivery.channel,
        });

        nextLastSent = {
          ...nextLastSent,
          [slot.baseTime]: slot.baseDate,
        };

        await updatePersona(persona.id, persona.userId, {
          personaData: withPersonaRuntimeDiagnostics(
            withProactiveMessageRuntime(
              withProactiveMessageConfig(personaData, { times }),
              { randomizedSchedule, lastSent: nextLastSent },
            ),
            buildProactiveRuntimeDiagnostics({
              runtimePlan: generated.runtimePlan,
              trigger: "scheduled",
              inputText: generated.inputText,
              replyText,
              delivery,
              now,
              details: {
                scheduledSlot: slot,
              },
            }),
          ),
          lastChatAt: now,
        });

        console.log(`[Proactive] Sent scheduled ${delivery.platform} message for persona ${persona.name} (${persona.id}) scheduled at ${slot.baseTime}, randomized ${slot.actualTime}, tick ${hhmm}`);
      }
    }
  } catch (error) {
    console.error("[Proactive] Scheduler tick failed:", error);
  } finally {
    running = false;
  }
}

export function startProactiveScheduler() {
  if (scheduler) return;
  scheduler = setInterval(() => void runProactiveTick(), 60_000);
  void runProactiveTick();
  console.log("[Proactive] Scheduler started");
}

export function stopProactiveScheduler() {
  if (!scheduler) return;
  clearInterval(scheduler);
  scheduler = null;
}
