import type { RoutineSlot } from "./life-schedule";

/**
 * 人物生活配置：把原先写死在代码里、只对单一人物成立的角色专有数据
 * （作息表 / 常驻设定 / 异地伴侣 / 原著专有词 / 用户性别代词）抽成 persona 级配置。
 * 缺省值 = 现状（王芃泽），所以不提供配置时行为完全不变；第二个分身经
 * `profileSections.life` 覆盖即可拥有自己的生活，无需改代码。
 * 注：由素材分析自动生成这份配置是后续工作，本模块只负责"读配置 / 给默认"。
 */

export type PersonaDayRoutines = {
  weekday: RoutineSlot[];
  saturday: RoutineSlot[];
  sunday: RoutineSlot[];
};

export type PersonaLifeConfig = {
  /** 三类日的作息槽；缺省时调用方使用 life-schedule 内置默认表 */
  routines?: PersonaDayRoutines;
  /** 生活行程 overlay 的「默认设定」行 */
  settingLine: string;
  /** 异地伴侣 / 重要对方的称呼，用于"被{partner}叫醒"等 */
  partnerName: string;
  /** 原著专有词表（source recall 关键词识别用） */
  sourceTerms: string[];
  /** 当前用户性别代词（长期记忆第三人称归一），默认男性"他" */
  userPronoun: "他" | "她";
  /** 用户问到原著核心人物关系、但证据不足时的「专属诚实兜底」文案（默认=王芃泽对柱子那段） */
  sourceFallbackReply: string;
  /** 触发上面专属兜底的核心人物名（默认「柱子」）；用户问题含它才用专属兜底，否则用通用「记不准」兜底 */
  sourceFallbackTrigger: string;
};

export const DEFAULT_SETTING_LINE =
  "默认设定：王芃泽常驻南京，工作日在南京研究所作息；敏子常驻武汉纺织大学。回复和主动消息都要承认两人是异地，不要默认同屋、同城、马上见面。";
export const DEFAULT_PARTNER_NAME = "敏子";
export const DEFAULT_SOURCE_TERMS = ["柱子", "王玉柱", "敏子", "王芃泽"];
export const DEFAULT_USER_PRONOUN: "他" | "她" = "他";
export const DEFAULT_SOURCE_FALLBACK_TRIGGER = "柱子";
export const DEFAULT_SOURCE_FALLBACK_REPLY =
  "这事我不能拿一句“我在”糊弄你。对柱子，最早是心疼和责任，后来也有放不下的牵挂；再具体的地方，我得按记得准的说，不能乱编。";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function lifeSection(personaData: unknown): Record<string, unknown> {
  if (!isRecord(personaData)) return {};
  const sections = isRecord(personaData.profileSections) ? personaData.profileSections : {};
  return isRecord(sections.life) ? sections.life : {};
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const items = value.map(item => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
  return items.length ? Array.from(new Set(items)) : fallback;
}

function parseRoutines(value: unknown): PersonaDayRoutines | undefined {
  if (!isRecord(value)) return undefined;
  const pick = (key: string) => (Array.isArray(value[key]) ? (value[key] as RoutineSlot[]) : undefined);
  const weekday = pick("weekday");
  const saturday = pick("saturday");
  const sunday = pick("sunday");
  if (weekday && saturday && sunday) return { weekday, saturday, sunday };
  return undefined;
}

/** 读取 persona 生活配置：`profileSections.life` 覆盖默认；无覆盖时返回默认（=现状）。 */
export function getPersonaLifeConfig(personaData: unknown): PersonaLifeConfig {
  const life = lifeSection(personaData);
  return {
    routines: parseRoutines(life.routines),
    settingLine: stringValue(life.settingLine, DEFAULT_SETTING_LINE),
    partnerName: stringValue(life.partnerName, DEFAULT_PARTNER_NAME),
    sourceTerms: stringArray(life.sourceTerms, DEFAULT_SOURCE_TERMS),
    userPronoun: life.userPronoun === "她" ? "她" : DEFAULT_USER_PRONOUN,
    sourceFallbackReply: stringValue(life.sourceFallbackReply, DEFAULT_SOURCE_FALLBACK_REPLY),
    sourceFallbackTrigger: stringValue(life.sourceFallbackTrigger, DEFAULT_SOURCE_FALLBACK_TRIGGER),
  };
}
