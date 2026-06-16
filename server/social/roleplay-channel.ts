import { llmService } from "../llm";
import { getCurrentLlmEconomyPolicy, type LlmEconomyLevel } from "../llm/economy";
import * as db from "../db";
import { buildSystemPrompt, computeEmotionalState } from "../_core/persona-utils";
import { cleanAssistantReply } from "../_core/reply-utils";

const ROLEPLAY_MOODS = ["warm", "playful", "nostalgic", "melancholy", "happy", "distant"] as const;

type RoleplayMood = typeof ROLEPLAY_MOODS[number];

export type RoleplayTurnMember = {
  personaId: number;
  displayOrder: number;
  speakingEnabled: boolean;
  analysisStatus?: string;
};

export type RoleplayTranscriptMessage = {
  personaId: number | null;
  speakerName: string;
  role: string;
  content: string;
  createdAt?: Date;
};

export type ParsedRoleplayTurn = {
  shouldSpeak: boolean;
  reply: string;
  innerThought: string;
  mood: RoleplayMood;
};

export type RunRoleplayTurnOptions = {
  channelId: number;
  userId: number;
  personaId?: number;
  allowSilence?: boolean;
};

export type RunRoleplayTurnResult = {
  spoken: boolean;
  channelId: number;
  personaId: number;
  speakerName: string;
  replyText: string;
  innerThought: string;
  emotionalState: RoleplayMood;
  messageId?: number;
};

function normalizeMood(value: unknown, fallback: string): RoleplayMood {
  const text = typeof value === "string" ? value.trim() : "";
  if ((ROLEPLAY_MOODS as readonly string[]).includes(text)) return text as RoleplayMood;
  if ((ROLEPLAY_MOODS as readonly string[]).includes(fallback)) return fallback as RoleplayMood;
  return "warm";
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const stripped = stripCodeFence(text);
  const candidates = [
    stripped,
    stripped.match(/\{[\s\S]*\}/)?.[0] ?? "",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function stripSpeakerPrefix(text: string, speakerName: string): string {
  const escaped = speakerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text
    .replace(new RegExp(`^\\s*${escaped}\\s*[：:]\\s*`), "")
    .replace(/^\s*(回复|发言|正文)\s*[：:]\s*/, "")
    .trim();
}

export function parseRoleplayTurnResponse(raw: string, speakerName: string, fallbackMood: string): ParsedRoleplayTurn {
  const parsed = extractJsonObject(raw);
  const shouldSpeak = parsed?.shouldSpeak !== false;
  const replyCandidate = typeof parsed?.reply === "string" ? parsed.reply : raw;
  const innerThought = typeof parsed?.innerThought === "string" ? parsed.innerThought.trim() : "";
  const mood = normalizeMood(parsed?.mood, fallbackMood);
  const reply = cleanAssistantReply(stripSpeakerPrefix(replyCandidate, speakerName), "我在。");

  return {
    shouldSpeak,
    reply,
    innerThought,
    mood,
  };
}

export function orderedEnabledRoleplayMembers<T extends RoleplayTurnMember>(members: T[]): T[] {
  return members
    .filter(member => member.speakingEnabled && (!member.analysisStatus || member.analysisStatus === "ready"))
    .sort((a, b) => a.displayOrder - b.displayOrder || a.personaId - b.personaId);
}

export function pickNextRoleplayMember<T extends RoleplayTurnMember>(
  members: T[],
  messages: RoleplayTranscriptMessage[],
  requestedPersonaId?: number,
): T | null {
  const enabled = orderedEnabledRoleplayMembers(members);
  if (enabled.length === 0) return null;

  if (requestedPersonaId) {
    return enabled.find(member => member.personaId === requestedPersonaId) ?? null;
  }

  const lastPersonaMessage = [...messages]
    .reverse()
    .find(message => message.role === "persona" && typeof message.personaId === "number");
  if (!lastPersonaMessage?.personaId) return enabled[0];

  const lastIndex = enabled.findIndex(member => member.personaId === lastPersonaMessage.personaId);
  if (lastIndex < 0) return enabled[0];
  return enabled[(lastIndex + 1) % enabled.length];
}

// 自动轮转时返回“按发言顺序、从下一位开始环绕一圈”的候选成员列表。
// 用于在某成员选择沉默时继续尝试下一位，避免轮转永久卡死在持续沉默的成员身上。
export function roleplayTurnCandidates<T extends RoleplayTurnMember>(
  members: T[],
  messages: RoleplayTranscriptMessage[],
  requestedPersonaId?: number,
): T[] {
  const enabled = orderedEnabledRoleplayMembers(members);
  if (enabled.length === 0) return [];
  if (requestedPersonaId) {
    const found = enabled.find(member => member.personaId === requestedPersonaId);
    return found ? [found] : [];
  }
  const start = pickNextRoleplayMember(members, messages);
  const startIndex = start ? enabled.findIndex(member => member.personaId === start.personaId) : 0;
  return enabled.map((_, offset) => enabled[(startIndex + offset) % enabled.length]);
}

export function formatRoleplayTranscript(messages: RoleplayTranscriptMessage[], maxChars = 6000): string {
  const lines = messages.map(message => {
    const label = message.role === "user" ? "用户" : message.speakerName;
    return `${label}: ${message.content.trim()}`;
  });
  const text = lines.join("\n").trim();
  return text.length > maxChars ? `...${text.slice(-maxChars)}` : text;
}

export function shouldSkipAutomaticRoleplayTurnForEconomy(
  level: LlmEconomyLevel,
  requestedPersonaId?: number,
): boolean {
  return level === "strict" && !requestedPersonaId;
}

function roleplayTranscriptLimit(level: LlmEconomyLevel): number {
  if (level === "strict") return 2400;
  if (level === "conservative") return 4200;
  return 6000;
}

function roleplayMaxTokens(level: LlmEconomyLevel, configured: unknown): number | undefined {
  const value = typeof configured === "number" && Number.isFinite(configured) ? configured : undefined;
  if (level === "strict") return Math.min(value ?? 260, 260);
  if (level === "conservative") return Math.min(value ?? 320, 320);
  return value;
}

function roleplaySceneOverlay(
  channel: db.RoleplayChannelView,
  speakerName: string,
): string {
  const memberNames = channel.members
    .map(member => member.personaName)
    .join("、");
  return [
    "【角色频道模式】",
    `频道：${channel.name}`,
    channel.description ? `频道说明：${channel.description}` : "",
    channel.scenePrompt ? `当前场景：${channel.scenePrompt}` : "",
    `频道成员：${memberNames}`,
    `你本轮只扮演 ${speakerName}。不要替其他角色说话，不要写其他角色的台词，也不要用“${speakerName}：”作为前缀。`,
    "这是多角色共同生活/对话频道，不是用户和你的一对一私聊。你可以自然接住上一位角色的话、延续场景，也可以表现出自己的当下心情。",
  ].filter(Boolean).join("\n");
}

function buildRoleplayUserPrompt(params: {
  channel: db.RoleplayChannelView;
  speakerName: string;
  transcript: string;
  allowSilence: boolean;
}): string {
  return [
    "请观察下面的频道最近记录，并以你当前角色的视角决定本轮反应。",
    params.transcript ? `【最近频道记录】\n${params.transcript}` : "【最近频道记录】\n（频道刚开始，还没有发言。）",
    params.allowSilence
      ? "如果此刻更适合沉默、观察或无事发生，可以让 shouldSpeak 为 false。"
      : "本轮需要生成一条自然发言，不要沉默。",
    "只返回 JSON，不要输出 Markdown，不要解释：",
    `{"shouldSpeak":true,"innerThought":"一句私密内心活动，不会直接发给别人","mood":"warm|playful|nostalgic|melancholy|happy|distant 之一","reply":"要发到频道里的正文"}`,
    "reply 要像真实聊天或生活场景里的发言，不要写动作旁白开头，不要剧本格式，不要替别人回应。",
  ].join("\n\n");
}

const runningRoleplayTurns = new Set<string>();

export async function runRoleplayChannelTurn(options: RunRoleplayTurnOptions): Promise<RunRoleplayTurnResult> {
  // 频道级并发互斥：避免多次 tick（多标签页 / 快速重点 / 同时“推进一轮”+“让某人说话”）
  // 并发读到同一份消息后各自插入发言，导致同一轮重复发言、游标双写。
  const lockKey = `${options.channelId}:${options.userId}`;
  if (runningRoleplayTurns.has(lockKey)) {
    throw new Error("该角色频道正在生成上一轮发言，请稍后再试");
  }
  runningRoleplayTurns.add(lockKey);
  try {
    const channel = await db.getRoleplayChannelById(options.channelId, options.userId);
    if (!channel || !channel.isActive) throw new Error("角色频道不存在或已停用");
    if (channel.members.length < 2) throw new Error("角色频道至少需要两个成员");

    const messages = await db.getRoleplayChannelMessages(options.channelId, options.userId, 40);
    const candidates = roleplayTurnCandidates(channel.members, messages, options.personaId);
    if (candidates.length === 0) throw new Error("没有可发言的频道成员");

    const defaultConfig = await db.getDefaultLlmConfig(options.userId);
    const extra = (defaultConfig?.extraConfig as any) || {};
    const economy = await getCurrentLlmEconomyPolicy();
    const lastMessageId = messages[messages.length - 1]?.id;

    if (shouldSkipAutomaticRoleplayTurnForEconomy(economy.level, options.personaId)) {
      const rep = candidates[0];
      const repPersona = await db.getPersonaById(rep.personaId, options.userId);
      await db.updateRoleplayMemberCursor(
        options.channelId,
        options.userId,
        rep.personaId,
        lastMessageId ?? rep.lastReadMessageId,
      );
      return {
        spoken: false,
        channelId: options.channelId,
        personaId: rep.personaId,
        speakerName: repPersona?.name ?? "",
        replyText: "",
        innerThought: "严格省额度模式下跳过自动轮转；可指定某个角色发言。",
        emotionalState: normalizeMood(repPersona?.emotionalState, repPersona?.emotionalState ?? "warm"),
      };
    }

    const transcript = formatRoleplayTranscript(messages, roleplayTranscriptLimit(economy.level));

    let lastTriedMember = candidates[0];
    let lastTriedPersona: Awaited<ReturnType<typeof db.getPersonaById>> | null = null;

    // 依次尝试候选成员：某成员选择沉默就让给下一位，避免轮转卡死在持续沉默的成员上。
    for (const member of candidates) {
      const persona = await db.getPersonaById(member.personaId, options.userId);
      if (!persona || persona.analysisStatus !== "ready") continue;
      lastTriedMember = member;
      lastTriedPersona = persona;

      const provider = (persona as any).llmProvider || undefined;
      const response = await llmService.invoke({
        messages: [
          {
            role: "system",
            content: buildSystemPrompt(persona, {
              sceneOverlay: roleplaySceneOverlay(channel, persona.name),
              longBackgroundMode: "compact",
            }),
          },
          {
            role: "user",
            content: buildRoleplayUserPrompt({
              channel,
              speakerName: persona.name,
              transcript,
              allowSilence: options.allowSilence === true,
            }),
          },
        ],
        options: {
          provider,
          temperature: extra.temperature,
          maxTokens: roleplayMaxTokens(economy.level, extra.maxTokens),
          purpose: "roleplay",
          userId: options.userId,
          personaId: persona.id,
          route: "roleplay.channel_turn",
        },
      });

      const parsed = parseRoleplayTurnResponse(response || "", persona.name, persona.emotionalState);
      if (options.allowSilence && !parsed.shouldSpeak) {
        continue;
      }

      const emotionalState = normalizeMood(
        parsed.mood,
        computeEmotionalState(transcript, parsed.reply, persona.emotionalState),
      );
      const message = await db.createRoleplayMessage({
        channelId: options.channelId,
        userId: options.userId,
        personaId: member.personaId,
        speakerName: persona.name,
        role: "persona",
        content: parsed.reply,
        innerThought: parsed.innerThought || null,
        moodState: {
          emotionalState,
          source: "roleplay_turn",
        },
        turnKind: "dialogue",
      });

      await db.updateRoleplayMemberCursor(options.channelId, options.userId, member.personaId, message.id);
      await db.updatePersona(member.personaId, options.userId, {
        chatCount: (persona.chatCount || 0) + 1,
        lastChatAt: new Date(),
        emotionalState: emotionalState as any,
      });

      return {
        spoken: true,
        channelId: options.channelId,
        personaId: member.personaId,
        speakerName: persona.name,
        replyText: parsed.reply,
        innerThought: parsed.innerThought,
        emotionalState,
        messageId: message.id,
      };
    }

    // 所有候选成员本轮都沉默（或不可用）：仍推进游标到最新消息，本轮无人发言。
    if (!lastTriedPersona) throw new Error("没有可发言的频道成员");
    await db.updateRoleplayMemberCursor(
      options.channelId,
      options.userId,
      lastTriedMember.personaId,
      lastMessageId ?? lastTriedMember.lastReadMessageId,
    );
    return {
      spoken: false,
      channelId: options.channelId,
      personaId: lastTriedMember.personaId,
      speakerName: lastTriedPersona.name,
      replyText: "",
      innerThought: "本轮所有角色都选择了沉默。",
      emotionalState: normalizeMood(lastTriedPersona.emotionalState, lastTriedPersona.emotionalState ?? "warm"),
    };
  } finally {
    runningRoleplayTurns.delete(lockKey);
  }
}
