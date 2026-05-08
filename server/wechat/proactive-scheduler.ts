import { llmService } from "../llm";
import {
  getActiveWechatBindingsByPersonaId,
  getDefaultLlmConfig,
  getReadyPersonasForProactiveMessages,
  getMessagesByPersonaId,
  updatePersona,
  createMessage,
} from "../db";
import { buildSystemPrompt } from "../_core/persona-utils";
import { stripLeadingAsides } from "../_core/reply-utils";
import { getBotStatus, sendWeChatText } from "./bot";

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

async function getRecentConversationContext(personaId: number): Promise<string> {
  const history = await getMessagesByPersonaId(personaId, 12);
  return history
    .slice(-10)
    .map((m) => {
      const who = m.role === "user" ? "用户" : "王芃泽";
      return `${who}（${m.channel}）：${m.content}`;
    })
    .join("\n");
}

async function generateProactiveMessage(persona: any, time: string): Promise<string> {
  const defaultConfig = await getDefaultLlmConfig(persona.userId);
  const extra = (defaultConfig?.extraConfig as any) || {};
  const personaData = (persona.personaData as any) || {};
  const proactive = personaData.proactiveMessages || {};
  const recentContext = await getRecentConversationContext(persona.id);

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

  return stripLeadingAsides(response || "我刚刚突然想到你，就想问问你现在在做什么。");
}

async function runProactiveTick() {
  if (running) return;
  running = true;

  try {
    const now = new Date();
    const today = currentDateKey(now);
    const hhmm = currentTimeKey(now);
    if (getBotStatus().status !== "logged_in") return;

    const personas = await getReadyPersonasForProactiveMessages();

    for (const persona of personas) {
      const personaData = ((persona.personaData as any) || {});
      const proactive = personaData.proactiveMessages || {};
      const times = Array.from(new Set((proactive.times || []).map(normalizeTime).filter(Boolean))) as string[];
      const dueTimes = getDueTimes(times, now);
      if (dueTimes.length === 0) continue;

      const lastSent = proactive.lastSent || {};
      let nextLastSent = { ...lastSent };

      const bindings = await getActiveWechatBindingsByPersonaId(persona.id, persona.userId);
      if (bindings.length === 0) {
        console.warn(`[Proactive] Persona ${persona.id} has no active WeChat binding`);
        continue;
      }

      for (const dueTime of dueTimes) {
        if (nextLastSent[dueTime] === today) continue;

        const replyText = await generateProactiveMessage(persona, dueTime);
        let sent = false;
        for (const binding of bindings) {
          sent = (await sendWeChatText(binding.wechatContactId, replyText, binding.wechatName)) || sent;
        }

        if (!sent) continue;

        await createMessage({
          personaId: persona.id,
          userId: persona.userId,
          role: "assistant",
          content: replyText,
          emotionalState: persona.emotionalState,
          channel: "wechat",
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

        console.log(`[Proactive] Sent scheduled message for persona ${persona.name} (${persona.id}) scheduled at ${dueTime}, tick ${hhmm}`);
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
