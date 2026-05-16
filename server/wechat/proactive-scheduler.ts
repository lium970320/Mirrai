import { llmService } from "../llm";
import {
  getDefaultLlmConfig,
  getReadyPersonasForProactiveMessages,
  getMessagesByPersonaId,
  updatePersona,
  createMessage,
} from "../db";
import { buildSystemPrompt } from "../_core/persona-utils";
import { cleanAssistantReply } from "../_core/reply-utils";
import { sendProactiveTextToPreferredPlatform } from "../social/proactive-delivery";
import {
  buildConversationContinuityInstruction,
  formatRecentConversationTimeline,
} from "../social/conversation-continuity";

let scheduler: ReturnType<typeof setInterval> | null = null;
let running = false;
const PROACTIVE_CATCH_UP_MINUTES = 15;

function currentDateKey(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function currentTimeKey(now = new Date()) {
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
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

function getDueTimes(times: string[], now: Date): string[] {
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return times.filter((time) => {
    const ageMinutes = nowMinutes - minutesSinceMidnight(time);
    return ageMinutes >= 0 && ageMinutes <= PROACTIVE_CATCH_UP_MINUTES;
  });
}

async function generateProactiveMessage(persona: any, time: string): Promise<string> {
  const defaultConfig = await getDefaultLlmConfig(persona.userId);
  const extra = (defaultConfig?.extraConfig as any) || {};
  const personaData = (persona.personaData as any) || {};
  const proactive = personaData.proactiveMessages || {};
  const history = await getMessagesByPersonaId(persona.id, 16);
  const recentContext = formatRecentConversationTimeline(history, persona.name, 10);
  const continuityInstruction = buildConversationContinuityInstruction(history, persona.name, "proactive");

  const response = await llmService.invoke({
    messages: [
      { role: "system", content: buildSystemPrompt(persona) },
      {
        role: "user",
        content: [
          `现在是用户预设的主动联系时间 ${time}。`,
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
    },
  });

  return cleanAssistantReply(response, "我刚刚突然想到你，就想问问你现在在做什么。");
}

async function runProactiveTick() {
  if (running) return;
  running = true;

  try {
    const now = new Date();
    const today = currentDateKey(now);
    const hhmm = currentTimeKey(now);
    const personas = await getReadyPersonasForProactiveMessages();

    for (const persona of personas) {
      const personaData = ((persona.personaData as any) || {});
      const proactive = personaData.proactiveMessages || {};
      const times = Array.from(new Set((proactive.times || []).map(normalizeTime).filter(Boolean))) as string[];
      const dueTimes = getDueTimes(times, now);
      if (dueTimes.length === 0) continue;

      const lastSent = proactive.lastSent || {};
      let nextLastSent = { ...lastSent };

      for (const dueTime of dueTimes) {
        if (nextLastSent[dueTime] === today) continue;

        const replyText = await generateProactiveMessage(persona, dueTime);
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
          [dueTime]: today,
        };

        await updatePersona(persona.id, persona.userId, {
          personaData: {
            ...personaData,
            proactiveMessages: {
              ...proactive,
              times,
              lastSent: nextLastSent,
            },
          },
          lastChatAt: new Date(),
        });

        console.log(`[Proactive] Sent scheduled ${delivery.platform} message for persona ${persona.name} (${persona.id}) scheduled at ${dueTime}, tick ${hhmm}`);
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
