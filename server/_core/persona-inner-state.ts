import { getPersonaScheduleState } from "./life-schedule";
import { getPersonaLifeConfig } from "./persona-life-config";
import { getPersonaRuntimeState } from "./persona-runtime";

/**
 * 人物「内在状态层」：把情绪从「每轮按当前消息现算的关键词标签」升级为
 * 「会延续、会随时间和作息衰减、有来源和挂心事」的连续内心状态。
 * 纯逻辑、无 LLM 调用、不绑定具体人物（基线由作息 + dayContext 派生）。
 */

export type ScheduleState = ReturnType<typeof getPersonaScheduleState>;

/** 人物「自己的一天」：与用户无关的日内心境种子，按 dateKey 失效重生。 */
export type PersonaDayContext = {
  dateKey: string;
  flavor: string;
  note: string;
  energyBias: number;
  valenceBias: number;
};

/** 关系温度：吵完该冷一阵、和好该回暖，跨多轮持续并随时间回归中性。 */
export type PersonaRelationshipTone = {
  /** close=亲近 tender=柔软深情 friction=别扭/有火 distant=疏远冷淡 */
  tone: "close" | "tender" | "friction" | "distant";
  intensity: number;
  updatedAt: string;
};

export type PersonaInnerState = {
  /** 细分心情词，如「有点闷」「愉快」「想念加重」 */
  mood: string;
  /** 情绪正负 -1..1 */
  valence: number;
  /** 精力 0..1（受作息/熬夜影响） */
  energy: number;
  /** 当前情绪强度 0..1（随时间衰减） */
  intensity: number;
  /** 这个心情的来源 */
  cause: string;
  /** 此刻挂心的事 */
  preoccupation: string;
  dayContext: PersonaDayContext | null;
  /** 关系温度（吵架/和好后跨轮延续），无则 null */
  relationshipTone: PersonaRelationshipTone | null;
  /** ISO 时间，用于衰减计算 */
  updatedAt: string;
};

const INTENSITY_HALFLIFE_HOURS = 4;
const INTENSITY_RELAX_THRESHOLD = 0.15;
/** 超过这个间隔（跨天/长时间没聊）视为新状态基线 */
const STALE_RESET_HOURS = 18;
const BASELINE_MOOD = "平静";
/** 关系张力比一般心情更持久 */
const TONE_HALFLIFE_HOURS = 12;
const TONE_RELAX_THRESHOLD = 0.2;

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function clampSigned(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(-1, value));
}

function textValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** 作息类别 → 精力基线（工作克制、居家放松、睡眠最低）。 */
function energyBaselineForSchedule(schedule: ScheduleState): number {
  switch (schedule.category) {
    case "sleep": return 0.15;
    case "wake": return 0.45;
    case "commute": return 0.55;
    case "work": return 0.5;
    case "meal": return 0.65;
    case "rest": return 0.6;
    case "home": return schedule.availability === "open" ? 0.85 : 0.7;
    default: return 0.6;
  }
}

/** 作息类别 → 情绪正负基线偏移：上班克制压抑、居家放松、夜里微软。 */
function valenceBaselineForSchedule(schedule: ScheduleState): number {
  switch (schedule.category) {
    case "work": return -0.12;
    case "commute": return -0.05;
    case "wake": return -0.03;
    case "meal": return 0.05;
    case "rest": return 0.05;
    case "home": return schedule.availability === "open" ? 0.12 : 0.06;
    default: return 0;
  }
}

/** 作息时段 → 无强情绪时的「默认心情」底色（上班闷、在家松、夜里静）。 */
function baselineMoodForSchedule(schedule: ScheduleState): string {
  switch (schedule.category) {
    case "sleep": return "困倦";
    case "wake": return "刚醒、还有点发懵";
    case "commute": return "在路上、心不在焉";
    case "work": return "有点闷、心思没全在这";
    case "meal": return "刚歇下来";
    case "rest": return "懒懒的、松着";
    case "home": return schedule.availability === "open" ? "松快" : "安静";
    default: return BASELINE_MOOD;
  }
}

function hoursSince(iso: string, now: Date): number {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now.getTime() - then) / 3_600_000);
}

// ─── Day context（Part B：人物自己的一天）───────────────────────────────

type DayFlavorDef = {
  id: string;
  note: string;
  energyBias: number;
  valenceBias: number;
  weekdayWeight: number;
  weekendWeight: number;
};

/** 中性日心境表（不绑定人物，后续可做成 persona 级配置）。 */
const DAY_FLAVORS: DayFlavorDef[] = [
  { id: "smooth", note: "今天过得还算顺，心里比较松快", energyBias: 0.1, valenceBias: 0.2, weekdayWeight: 3, weekendWeight: 4 },
  { id: "tired", note: "今天有点累，精力不太够", energyBias: -0.2, valenceBias: -0.05, weekdayWeight: 3, weekendWeight: 1 },
  { id: "stressed", note: "今天事情多、被催着走，心里有点紧", energyBias: -0.1, valenceBias: -0.15, weekdayWeight: 2, weekendWeight: 0 },
  { id: "missing", note: "今天莫名更想念对方一些", energyBias: 0, valenceBias: -0.05, weekdayWeight: 2, weekendWeight: 2 },
  { id: "light", note: "今天状态不错，心情轻快", energyBias: 0.15, valenceBias: 0.2, weekdayWeight: 1, weekendWeight: 3 },
  { id: "flat", note: "今天平平淡淡，没什么特别的", energyBias: 0, valenceBias: 0, weekdayWeight: 3, weekendWeight: 3 },
];

/** 稳定哈希：同一 (personaId, dateKey) 当天始终得到同一个 flavor。 */
function stableHash(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pickDayFlavor(personaId: number, schedule: ScheduleState): DayFlavorDef {
  const isWeekend = schedule.dayKind !== "weekday";
  const weightOf = (f: DayFlavorDef) => (isWeekend ? f.weekendWeight : f.weekdayWeight);
  const total = DAY_FLAVORS.reduce((sum, f) => sum + weightOf(f), 0);
  if (total <= 0) return DAY_FLAVORS[DAY_FLAVORS.length - 1];
  let cursor = stableHash(`${personaId}:${schedule.dateKey}`) % total;
  for (const flavor of DAY_FLAVORS) {
    cursor -= weightOf(flavor);
    if (cursor < 0) return flavor;
  }
  return DAY_FLAVORS[DAY_FLAVORS.length - 1];
}

/** 确保有当天的 dayContext；dateKey 变化或缺失时按稳定种子重生。 */
export function ensureDayContext(
  prev: PersonaDayContext | null,
  personaId: number,
  schedule: ScheduleState,
): PersonaDayContext {
  if (prev && prev.dateKey === schedule.dateKey) return prev;
  const flavor = pickDayFlavor(personaId, schedule);
  return {
    dateKey: schedule.dateKey,
    flavor: flavor.id,
    note: flavor.note,
    energyBias: flavor.energyBias,
    valenceBias: flavor.valenceBias,
  };
}

// ─── 读取 + 衰减 ────────────────────────────────────────────────────────

function normalizeTone(raw: unknown): PersonaRelationshipTone | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const tone = textValue(r.tone);
  const updatedAt = textValue(r.updatedAt);
  if (!["close", "tender", "friction", "distant"].includes(tone) || !updatedAt) return null;
  return {
    tone: tone as PersonaRelationshipTone["tone"],
    intensity: clampUnit(numberValue(r.intensity, 0)),
    updatedAt,
  };
}

function normalizeInnerState(raw: unknown): PersonaInnerState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const updatedAt = textValue(r.updatedAt);
  if (!updatedAt) return null;
  const day = r.dayContext;
  const dayContext = day && typeof day === "object" && !Array.isArray(day)
    ? {
      dateKey: textValue((day as any).dateKey),
      flavor: textValue((day as any).flavor),
      note: textValue((day as any).note),
      energyBias: numberValue((day as any).energyBias, 0),
      valenceBias: numberValue((day as any).valenceBias, 0),
    }
    : null;
  return {
    mood: textValue(r.mood, BASELINE_MOOD),
    valence: clampSigned(numberValue(r.valence, 0)),
    energy: clampUnit(numberValue(r.energy, 0.6)),
    intensity: clampUnit(numberValue(r.intensity, 0)),
    cause: textValue(r.cause),
    preoccupation: textValue(r.preoccupation),
    dayContext: dayContext && dayContext.dateKey ? dayContext : null,
    relationshipTone: normalizeTone(r.relationshipTone),
    updatedAt,
  };
}

function baselineInnerState(now: Date, schedule: ScheduleState, dayContext: PersonaDayContext): PersonaInnerState {
  return {
    mood: baselineMoodForSchedule(schedule),
    valence: clampSigned(dayContext.valenceBias + valenceBaselineForSchedule(schedule)),
    energy: clampUnit(energyBaselineForSchedule(schedule) + dayContext.energyBias),
    intensity: 0,
    cause: "",
    preoccupation: "",
    dayContext,
    relationshipTone: null,
    updatedAt: now.toISOString(),
  };
}

/** 关系温度独立衰减：吵完的别扭会持续一阵再回归中性（半衰期比心情长）。 */
function decayTone(tone: PersonaRelationshipTone | null, now: Date): PersonaRelationshipTone | null {
  if (!tone) return null;
  const intensity = clampUnit(tone.intensity * 0.5 ** (hoursSince(tone.updatedAt, now) / TONE_HALFLIFE_HOURS));
  if (intensity < TONE_RELAX_THRESHOLD) return null;
  return { ...tone, intensity };
}

/** 把上一持久状态按经过时间衰减：强度指数衰减、精力回到作息+当天基线、强度过低则心情松回平静。 */
function decayInnerState(prev: PersonaInnerState, schedule: ScheduleState, dayContext: PersonaDayContext, now: Date): PersonaInnerState {
  const elapsed = hoursSince(prev.updatedAt, now);
  const intensity = clampUnit(prev.intensity * 0.5 ** (elapsed / INTENSITY_HALFLIFE_HOURS));
  const energyTarget = clampUnit(energyBaselineForSchedule(schedule) + dayContext.energyBias);
  // 情绪正负的回归目标 = 今天基调 + 当前作息底色（上班往闷里收、在家往松里走）。
  const valenceTarget = clampSigned(dayContext.valenceBias + valenceBaselineForSchedule(schedule));
  // 强度越低，越向基线靠拢（情绪平复）。
  const pull = clampUnit(1 - intensity);
  const energy = clampUnit(prev.energy + (energyTarget - prev.energy) * pull);
  const valence = clampSigned(prev.valence + (valenceTarget - prev.valence) * pull);
  const relaxed = intensity < INTENSITY_RELAX_THRESHOLD;
  return {
    // 平复后心情松回「当前作息的底色」，而不是永远的「平静」。
    mood: relaxed ? baselineMoodForSchedule(schedule) : prev.mood,
    valence,
    energy,
    intensity,
    cause: relaxed ? "" : prev.cause,
    preoccupation: prev.preoccupation,
    dayContext,
    relationshipTone: prev.relationshipTone,
    updatedAt: now.toISOString(),
  };
}

/**
 * 读取人物当前「有效」内在状态：读持久值并按经过时间衰减/漂移；缺失或太久没聊则回到当天基线。
 * 这是回复链路读心情的唯一入口。
 */
export function getEffectiveInnerState(personaData: unknown, personaId: number, now = new Date()): PersonaInnerState {
  const schedule = getPersonaScheduleState(now, getPersonaLifeConfig(personaData));
  const stored = normalizeInnerState(getPersonaRuntimeState(personaData).runtimeInnerState);
  const dayContext = ensureDayContext(stored?.dayContext ?? null, personaId, schedule);
  // 关系温度独立于心情衰减，即使长时间没聊也保留余温/余气（按更长半衰期）。
  const relationshipTone = decayTone(stored?.relationshipTone ?? null, now);
  if (!stored || hoursSince(stored.updatedAt, now) > STALE_RESET_HOURS) {
    return { ...baselineInnerState(now, schedule, dayContext), relationshipTone };
  }
  return { ...decayInnerState(stored, schedule, dayContext, now), relationshipTone };
}

// ─── 提示词覆盖块 ──────────────────────────────────────────────────────

function energyToneHint(energy: number): string {
  if (energy < 0.3) return "精力偏低：回复更短、更慢，像有点累的人，不要硬撑得很热闹。";
  if (energy < 0.6) return "精力一般：自然就好，不必刻意活跃。";
  return "精力较好：可以更主动、更有来有回。";
}

function toneOverlayLine(tone: PersonaRelationshipTone | null): string {
  if (!tone || tone.intensity < TONE_RELAX_THRESHOLD) return "";
  const desc: Record<PersonaRelationshipTone["tone"], string> = {
    close: "你和对方最近关系亲近、踏实，语气可以更自然亲昵。",
    tender: "你对对方正处在柔软、深情的状态，愿意多给一点温度。",
    friction: "你和对方之间还有点没消的别扭/火气，别立刻装作没事——可以稍微收着点、慢一点热络，但也别翻旧账、别赌气扩大。",
    distant: "你最近和对方有点疏远，热度提不太起来，回复偏淡一些是自然的。",
  };
  return `关系温度：${desc[tone.tone]}（自然流露，别直接说破或复述这句）`;
}

/** 生成注入系统提示词的【当前内心状态】块；强调这是延续状态、自然流露、不要直接报出来。 */
/** 作息×情绪的协同提示：把「此刻在上班还是在家」翻成对语气的具体指引。 */
function scheduleEmotionHint(schedule?: { category: string; availability: string }): string {
  if (!schedule) return "";
  switch (schedule.category) {
    case "work":
      return "你现在在所里上班，心思没法全放在对话上——回复短一些、克制一些，像工作间隙抽空回的样子。";
    case "commute":
      return "你正在通勤路上，低头看一眼手机的状态，回复短促自然就好。";
    case "sleep":
      return "你这会儿本该睡着，除非被叫醒，语气要低、慢、短。";
    case "meal":
      return "你正在吃饭或刚歇下来，语气日常、放松。";
    case "home":
      return schedule.availability === "open"
        ? "你现在在家、空下来了，可以更自在、更有来有回；心情好就让它自然流露。"
        : "你现在在家，状态比上班松；夜深了的话语气可以更柔、更低一点。";
    default:
      return "";
  }
}

export function buildInnerStateOverlay(state: PersonaInnerState, schedule?: ScheduleState): string {
  const lines = [
    "【当前内心状态】",
    "以下是你此刻延续下来的心情，不是对用户这条消息的即时反应。让它自然影响你的语气和主动性，但不要直接说破，也不要解释这些字段。",
    `心情：${state.mood}（强度 ${state.intensity.toFixed(2)}）`,
    state.cause ? `来由：${state.cause}` : "",
    state.dayContext?.note ? `今天：${state.dayContext.note}` : "",
    state.preoccupation ? `还惦记着：${state.preoccupation}` : "",
    toneOverlayLine(state.relationshipTone),
    energyToneHint(state.energy),
    scheduleEmotionHint(schedule),
    "如果这份心情和用户当前消息明显不搭（比如你正低落但对方很兴奋），先接住对方，再让自己的状态稍微流露，而不是瞬间切换成完全相反的情绪。",
  ];
  return lines.filter(Boolean).join("\n");
}

// ─── 回合后更新 ────────────────────────────────────────────────────────

type EvolveSignals = {
  reflectionMood?: string;
  reflectionInnerReaction?: string;
  /** 本轮意图，用来推情绪方向与抬升强度 */
  intent?: string;
  preoccupation?: string;
  /** 关系信号：friction=冷漠/生气/吵 warm=被关心/亲密；由调用方按文本判定 */
  relationshipSignal?: "friction" | "warm";
};

function nextTone(
  intent: string | undefined,
  signal: "friction" | "warm" | undefined,
  prev: PersonaRelationshipTone | null,
  now: Date,
): PersonaRelationshipTone | null {
  let tone: PersonaRelationshipTone["tone"] | undefined;
  if (signal === "friction") tone = "friction";
  else if (signal === "warm" || intent === "affection_expression") tone = "tender";
  else if (intent === "emotional_support" || intent === "teasing") tone = "close";
  if (!tone) return prev; // 普通轮不主动改关系温度，让它自然衰减
  // 同向叠加抬升；反向（如 friction→tender 和好）直接重置为新基础强度。
  const base = prev?.tone === tone ? Math.max(prev.intensity, 0.6) : 0.6;
  return { tone, intensity: clampUnit(base), updatedAt: now.toISOString() };
}

function valenceShiftForIntent(intent: string | undefined): number {
  switch (intent) {
    case "affection_expression": return 0.25;
    case "teasing": return 0.2;
    case "daily_chat": return 0.05;
    case "emotional_support": return -0.1;
    case "correction": return -0.15;
    default: return 0;
  }
}

function compactCause(text: string): string {
  const chars = Array.from(text.replace(/\s+/g, " ").trim());
  return chars.length <= 60 ? chars.join("") : `${chars.slice(0, 60).join("")}...`;
}

/**
 * 回合结束后演进内在状态：融合 reflection 的心情/内心反应 + 本轮意图情绪方向 + 衰减后的精力。
 * 传入的 `effective` 应是本轮 getEffectiveInnerState 的结果（已衰减）。
 */
export function evolveInnerState(effective: PersonaInnerState, signals: EvolveSignals, now = new Date()): PersonaInnerState {
  const mood = textValue(signals.reflectionMood) || effective.mood || BASELINE_MOOD;
  const cause = signals.reflectionInnerReaction
    ? compactCause(signals.reflectionInnerReaction)
    : effective.cause;
  const valence = clampSigned(effective.valence + valenceShiftForIntent(signals.intent));
  // 有了新的情绪事件，强度抬升但不超过 1；普通日常抬升少。
  const bump = signals.intent === "daily_chat" || !signals.intent ? 0.3 : 0.55;
  const intensity = clampUnit(Math.max(effective.intensity, bump));
  return {
    mood,
    valence,
    energy: effective.energy,
    intensity,
    cause,
    preoccupation: textValue(signals.preoccupation) || effective.preoccupation,
    dayContext: effective.dayContext,
    relationshipTone: nextTone(signals.intent, signals.relationshipSignal, effective.relationshipTone, now),
    updatedAt: now.toISOString(),
  };
}

// ─── 兼容旧 emotionalState 标签 ────────────────────────────────────────

/** 把连续状态映射回旧 6 标签，喂 emotionalState 列（保持亲密度/毕业判定兼容）。 */
export function deriveEmotionalLabel(state: PersonaInnerState): string {
  if (/想念|思念|想你|想她|想他|怀念/.test(state.mood + state.cause)) return "nostalgic";
  if (state.valence <= -0.3) return "melancholy";
  if (state.valence >= 0.4 && state.energy >= 0.5) return "happy";
  if (/俏皮|调侃|玩笑|逗|撒娇/.test(state.mood)) return "playful";
  if (state.energy < 0.3 || /疏离|心不在焉|冷/.test(state.mood)) return "distant";
  return "warm";
}
