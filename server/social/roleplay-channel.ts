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

export function pickNextRoleplayMember<T extends RoleplayTurnMember>(
  members: T[],
  messages: RoleplayTranscriptMessage[],
  requestedPersonaId?: number,
): T | null {
  const enabled = members
    .filter(member => member.speakingEnabled && (!member.analysisStatus || member.analysisStatus === "ready"))
    .sort((a, b) => a.displayOrder - b.displayOrder || a.personaId - b.personaId);
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

export async function runRoleplayChannelTurn(options: RunRoleplayTurnOptions): Promise<RunRoleplayTurnResult> {
  const channel = await db.getRoleplayChannelById(options.channelId, options.userId);
  if (!channel || !channel.isActive) throw new Error("角色频道不存在或已停用");
  if (channel.members.length < 2) throw new Error("角色频道至少需要两个成员");

  const messages = await db.getRoleplayChannelMessages(options.channelId, options.userId, 40);
  const member = pickNextRoleplayMember(channel.members, messages, options.personaId);
  if (!member) throw new Error("没有可发言的频道成员");
  if (member.analysisStatus !== "ready") throw new Error("该角色还未准备好，不能参与角色频道");

  const persona = await db.getPersonaById(member.personaId, options.userId);
  if (!persona || persona.analysisStatus !== "ready") throw new Error("角色不存在或还未准备好");

  const defaultConfig = await db.getDefaultLlmConfig(options.userId);
  const extra = (defaultConfig?.extraConfig as any) || {};
  const provider = (persona as any).llmProvider || undefined;
  const economy = await getCurrentLlmEconomyPolicy();

  if (shouldSkipAutomaticRoleplayTurnForEconomy(economy.level, options.personaId)) {
    await db.updateRoleplayMemberCursor(
      options.channelId,
      options.userId,
      member.personaId,
      messages[messages.length - 1]?.id ?? member.lastReadMessageId,
    );
    return {
      spoken: false,
      channelId: options.channelId,
      personaId: member.personaId,
      speakerName: persona.name,
      replyText: "",
      innerThought: "严格省额度模式下跳过自动轮转；可指定某个角色发言。",
      emotionalState: normalizeMood(persona.emotionalState, persona.emotionalState),
    };
  }

  const transcript = formatRoleplayTranscript(messages, roleplayTranscriptLimit(economy.level));

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
    await db.updateRoleplayMemberCursor(
      options.channelId,
      options.userId,
      member.personaId,
      messages[messages.length - 1]?.id ?? member.lastReadMessageId,
    );
    return {
      spoken: false,
      channelId: options.channelId,
      personaId: member.personaId,
      speakerName: persona.name,
      replyText: "",
      innerThought: parsed.innerThought,
      emotionalState: parsed.mood,
    };
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
