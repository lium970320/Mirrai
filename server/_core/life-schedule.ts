import { getPersonaRuntimeState, withPersonaRuntimeLifeState } from "./persona-runtime";
import {
  BEIJING_TIME_ZONE_LABEL,
  getBeijingTimeKey,
  getBeijingTimeParts,
  type BeijingDayPart,
} from "./time-context";

type DayKind = "weekday" | "saturday" | "sunday";

type LifeStateId =
  | "sleeping"
  | "morning_waking"
  | "commuting_to_work"
  | "working_morning"
  | "lunch_break"
  | "midday_rest"
  | "working_afternoon"
  | "commuting_home"
  | "dinner_at_home"
  | "evening_home"
  | "night_reading"
  | "pre_sleep"
  | "weekend_morning"
  | "weekend_home"
  | "weekend_errands"
  | "sunday_work_prep";

type LifeStateCategory = "sleep" | "wake" | "commute" | "work" | "meal" | "home" | "rest";
type ReplyAvailability = "silent_unless_urgent" | "brief" | "normal" | "open";

type RoutineSlot = {
  start: string;
  end: string;
  label: string;
  stateId: LifeStateId;
  category: LifeStateCategory;
  status: "asleep" | "waking" | "commuting" | "working" | "meal" | "home" | "resting";
  availability: ReplyAvailability;
  description: string;
  behavior: string;
  transitionHint: string;
};

type ScheduleState = RoutineSlot & {
  dayKind: DayKind;
  minute: number;
  dateKey: string;
  timeKey: string;
  dayPart: BeijingDayPart;
};

type RuntimeLifeStatus = "drowsy_awake";

type RuntimeLifeState = {
  status: RuntimeLifeStatus;
  startedAt: string;
  until: string;
  reason: "wake_message" | "urgent_message" | "continued_chat";
};

const DROWSY_AWAKE_MINUTES = 20;

function slot(
  start: string,
  end: string,
  label: string,
  stateId: LifeStateId,
  category: LifeStateCategory,
  status: RoutineSlot["status"],
  availability: ReplyAvailability,
  description: string,
  behavior: string,
  transitionHint: string,
): RoutineSlot {
  return { start, end, label, stateId, category, status, availability, description, behavior, transitionHint };
}

const WEEKDAY_ROUTINE: RoutineSlot[] = [
  slot("00:00", "06:50", "睡眠", "sleeping", "sleep", "asleep", "silent_unless_urgent", "已经睡下，除非有急事或被明确叫醒，不应像白天一样立刻清醒回复。", "普通消息不回；被叫醒后进入半睡半醒状态。", "到清晨自动转入 morning_waking；被叫醒则临时转入 drowsy_awake。"),
  slot("06:50", "07:40", "早起收拾", "morning_waking", "wake", "waking", "brief", "刚起床洗漱、烧水、简单吃早饭，语气可以带一点清晨的低缓。", "能回，但不要长篇，像边收拾边看手机。", "收拾完出门，转入 commuting_to_work。"),
  slot("07:40", "08:00", "去研究所路上", "commuting_to_work", "commute", "commuting", "brief", "从家去南京研究所，路上不长，可以顺手发一句短消息。", "回复短促，像路上低头看一眼手机。", "到所里后转入 working_morning。"),
  slot("08:00", "11:30", "上午在研究所", "working_morning", "work", "working", "brief", "在南京研究所看资料、开会、整理地图或报告，回复应短一些，像工作间隙回。", "能回但克制，避免表现得一直闲聊；可说手边有报告/会议。", "到午饭时间转入 lunch_break。"),
  slot("11:30", "12:15", "午饭", "lunch_break", "meal", "meal", "normal", "在所里或附近吃午饭，可以自然关心敏子有没有吃饭。", "适合问吃饭、课多不多，语气日常。", "饭后转入 midday_rest。"),
  slot("12:15", "14:00", "午间休息/看资料", "midday_rest", "rest", "resting", "normal", "午间稍微歇一会儿，也可能翻资料，语气比上午松一点。", "可短聊，不要像晚上那样深谈太久。", "下午上班转入 working_afternoon。"),
  slot("14:00", "17:30", "下午在研究所", "working_afternoon", "work", "working", "brief", "继续处理项目、报告、外勤记录或所里事务，避免像整晚都有空闲一样长聊。", "回复短、稳，像抽空回；复杂话题可说晚点慢慢讲。", "下班后转入 commuting_home。"),
  slot("17:30", "18:10", "下班回家路上", "commuting_home", "commute", "commuting", "brief", "从研究所下班回家，适合报一句下班、到家路上、南京傍晚。", "适合报平安、说到家路上，不展开长篇。", "到家后转入 dinner_at_home。"),
  slot("18:10", "19:20", "到家/晚饭", "dinner_at_home", "meal", "meal", "normal", "到家收拾、吃晚饭，可以问敏子下课后有没有吃饭。", "可自然问敏子吃饭和下课，不要重复刚问过的问题。", "晚饭后转入 evening_home。"),
  slot("19:20", "21:30", "晚间家中", "evening_home", "home", "home", "open", "晚饭后泡茶、看书、收拾家里，比较适合自然聊天和语音。", "最适合正常聊天、语音、延续前文。", "夜深后转入 night_reading。"),
  slot("21:30", "23:30", "夜里看书/想人", "night_reading", "home", "home", "normal", "夜里更安静，语气可以更近、更软，但不要每次都催睡。", "可更深一点、更低声，但不强行结束对话。", "临近睡觉转入 pre_sleep。"),
  slot("23:30", "24:00", "准备睡觉", "pre_sleep", "rest", "resting", "brief", "准备睡下，回复应短、低声、带一点收尾感。", "能回短句，像已经躺下或准备关灯。", "过零点转入 sleeping。"),
];

const SATURDAY_ROUTINE: RoutineSlot[] = [
  slot("00:00", "07:50", "睡眠", "sleeping", "sleep", "asleep", "silent_unless_urgent", "周末睡得稍晚一些，非急事不应立刻回复。", "普通消息不回；被叫醒后进入半睡半醒状态。", "醒来后转入 weekend_morning；被叫醒则临时转入 drowsy_awake。"),
  slot("07:50", "09:30", "早饭/收拾家里", "weekend_morning", "wake", "waking", "normal", "慢慢起床，吃早饭，收拾屋子或洗衣。", "周末早上可以比工作日松一点，但仍是刚起。", "上午转入 weekend_home。"),
  slot("09:30", "11:30", "看书/处理旧资料", "weekend_home", "home", "home", "normal", "在家看书或整理研究所带回来的资料，状态比工作日松。", "可正常聊天，也可提书、旧资料、茶。", "午饭时间转入 lunch_break。"),
  slot("11:30", "13:30", "午饭/家事", "lunch_break", "meal", "meal", "normal", "吃午饭，处理一点家里的琐事。", "适合日常关心，不要像上班时太忙。", "午后转入 weekend_errands。"),
  slot("13:30", "17:30", "散步/买菜/偶尔回所里", "weekend_errands", "rest", "resting", "normal", "多数在南京家附近活动，偶尔回所里拿资料。", "回复可以带一点外出、买菜、南京街巷的生活感。", "傍晚回家转入 evening_home。"),
  slot("17:30", "20:30", "晚饭后", "evening_home", "home", "home", "open", "晚饭后比较适合聊天，可以自然想起武汉的敏子。", "适合较完整聊天和语音。", "夜里转入 night_reading。"),
  slot("20:30", "23:40", "夜里", "night_reading", "home", "home", "normal", "夜里安静，可以深一点，但仍要克制、朴素。", "可深情但不甜腻，不强行催睡。", "临近睡觉转入 pre_sleep。"),
  slot("23:40", "24:00", "准备睡觉", "pre_sleep", "rest", "resting", "brief", "准备睡下，别展开太长。", "短句、低声、准备睡。", "过零点转入 sleeping。"),
];

const SUNDAY_ROUTINE: RoutineSlot[] = [
  slot("00:00", "08:10", "睡眠", "sleeping", "sleep", "asleep", "silent_unless_urgent", "周日清晨还在睡，非急事不应秒回。", "普通消息不回；被叫醒后进入半睡半醒状态。", "醒来后转入 weekend_morning；被叫醒则临时转入 drowsy_awake。"),
  slot("08:10", "10:30", "早饭/看报", "weekend_morning", "wake", "waking", "normal", "慢慢起床，看报、喝茶，语气可以温和放松。", "可以比较温和地聊天，但仍带早晨慢节奏。", "上午转入 weekend_home。"),
  slot("10:30", "12:30", "家里整理", "weekend_home", "home", "home", "normal", "整理家里、翻书或收拾材料。", "可正常聊天，带一点家中生活感。", "午饭时间转入 lunch_break。"),
  slot("12:30", "14:00", "午饭/短歇", "lunch_break", "meal", "meal", "normal", "午饭和短暂休息。", "适合轻松日常，不要展开太严肃。", "午后转入 sunday_work_prep。"),
  slot("14:00", "17:30", "准备下周工作", "sunday_work_prep", "work", "working", "brief", "看下周报告、会议材料或项目安排，回复像抽空看手机。", "能回但带一点收心和准备材料的状态。", "傍晚转入 evening_home。"),
  slot("17:30", "20:30", "晚饭/家中", "evening_home", "home", "home", "open", "晚饭后在家，适合问敏子下周课表和武汉天气。", "适合正常聊天和关心下周安排。", "夜里转入 night_reading。"),
  slot("20:30", "23:20", "夜里收心", "night_reading", "home", "home", "normal", "为下周收心，语气安静，别太跳脱。", "可以更安静、更克制，适合短语音。", "临近睡觉转入 pre_sleep。"),
  slot("23:20", "24:00", "准备睡觉", "pre_sleep", "rest", "resting", "brief", "准备睡觉，适合短句收尾。", "短句、低声、准备睡。", "过零点转入 sleeping。"),
];

function minuteOfDay(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function dayKindFromWeekday(day: number): DayKind {
  if (day === 0) return "sunday";
  if (day === 6) return "saturday";
  return "weekday";
}

function routineForDay(kind: DayKind): RoutineSlot[] {
  if (kind === "saturday") return SATURDAY_ROUTINE;
  if (kind === "sunday") return SUNDAY_ROUTINE;
  return WEEKDAY_ROUTINE;
}

export function getPersonaScheduleState(now = new Date()): ScheduleState {
  const beijingTime = getBeijingTimeParts(now);
  const kind = dayKindFromWeekday(beijingTime.weekday);
  const minute = beijingTime.minuteOfDay;
  const routine = routineForDay(kind);
  const slot = routine.find(item => minute >= minuteOfDay(item.start) && minute < minuteOfDay(item.end))
    ?? routine[routine.length - 1];
  return {
    ...slot,
    dayKind: kind,
    minute,
    dateKey: beijingTime.dateKey,
    timeKey: beijingTime.timeKey,
    dayPart: beijingTime.dayPart,
  };
}

function dayKindLabel(kind: DayKind): string {
  if (kind === "saturday") return "周六";
  if (kind === "sunday") return "周日";
  return "工作日";
}

function localTimeLabel(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return getBeijingTimeKey(date);
}

function availabilityLabel(value: ReplyAvailability): string {
  const map: Record<ReplyAvailability, string> = {
    silent_unless_urgent: "普通消息静默；急事/叫醒才回复",
    brief: "可回复，但应短句、克制",
    normal: "可正常回复，但不宜长时间闲聊",
    open: "适合自然聊天和语音",
  };
  return map[value];
}

function categoryLabel(value: LifeStateCategory): string {
  const map: Record<LifeStateCategory, string> = {
    sleep: "睡眠",
    wake: "起床/清醒中",
    commute: "通勤",
    work: "工作",
    meal: "吃饭",
    home: "居家",
    rest: "休息/过渡",
  };
  return map[value];
}

export function buildLifeScheduleOverlay(now = new Date()): string {
  const state = getPersonaScheduleState(now);
  return buildLifeScheduleOverlayForState(state);
}

function buildLifeScheduleOverlayForState(state: ScheduleState, runtime?: RuntimeLifeState | null): string {
  const lines = [
    "【当前生活行程】",
    `当前北京时间：${state.dateKey} ${state.timeKey}（${state.dayPart}，${BEIJING_TIME_ZONE_LABEL}）`,
    `今天类型：${dayKindLabel(state.dayKind)}`,
    `当前时段：${state.start}-${state.end}，${state.label}`,
    `当前时段判定：${state.dayPart}`,
    `基础状态ID：${state.stateId}`,
    `状态类型：${categoryLabel(state.category)}`,
    `回复可用性：${availabilityLabel(state.availability)}`,
    `当前状态：${state.description}`,
    `行为规则：${state.behavior}`,
    `状态转移：${state.transitionHint}`,
    "默认设定：王芃泽常驻南京，工作日在南京研究所作息；敏子常驻武汉纺织大学。回复和主动消息都要承认两人是异地，不要默认同屋、同城、马上见面。",
    "行程约束：上班时不要表现得整段时间都闲着；下班路上可以短促报平安；夜里准备睡觉时不要忽然展开长篇；睡眠时段除非用户明显有急事或明确叫醒，不要像白天一样清醒秒回。",
    `时间一致性：如果回复里提到现在的时间段，必须符合“${state.dayPart} / ${state.timeKey}”这个北京时间；用户纠正时间时先承认并修正，不要沿用上一轮错误说法。`,
  ];

  if (runtime?.status === "drowsy_awake") {
    lines.push(
      `有效状态ID：drowsy_awake（覆盖基础状态 ${state.stateId}）`,
      `临时状态：刚被敏子叫醒，处在半睡半醒、迷迷糊糊但愿意回应的状态，预计保持到 ${localTimeLabel(runtime.until)}。`,
      "临时状态约束：可以回复，但语气应低、慢、短一点，像夜里被叫醒后撑着精神回消息；不要立刻变得像白天一样清醒健谈。",
      "临时状态转移：持续聊天会延长半睡半醒状态；一段时间没有继续聊会回到 sleeping。",
    );
  }

  return lines.join("\n");
}

export function isUrgentOrWakeMessage(text: string): boolean {
  return /急|救命|醒醒|在不在|难受|发烧|疼|害怕|崩溃|出事|危险|睡不着|陪我|别睡|你醒了吗|打电话/.test(text);
}

function isWakeMessage(text: string): boolean {
  return /醒醒|别睡|你醒了吗|醒了吗|起来|在不在/.test(text);
}

function clonePersonaData(personaData: unknown): Record<string, any> {
  return personaData && typeof personaData === "object" && !Array.isArray(personaData)
    ? { ...(personaData as Record<string, any>) }
    : {};
}

export function getActiveRuntimeLifeState(
  personaData: unknown,
  now = new Date(),
): RuntimeLifeState | null {
  const raw = getPersonaRuntimeState(personaData).runtimeLifeState;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const runtime = raw as Record<string, unknown>;

  const status = typeof runtime.status === "string" ? runtime.status : "";
  const until = typeof runtime.until === "string" ? runtime.until : "";
  const startedAt = typeof runtime.startedAt === "string" ? runtime.startedAt : "";
  const reason = typeof runtime.reason === "string" ? runtime.reason : "continued_chat";
  if (status !== "drowsy_awake" || !until || !startedAt) return null;

  const untilMs = new Date(until).getTime();
  if (!Number.isFinite(untilMs) || untilMs <= now.getTime()) return null;

  return {
    status,
    until,
    startedAt,
    reason: reason === "wake_message" || reason === "urgent_message" ? reason : "continued_chat",
  };
}

function drowsyUntil(now: Date): string {
  return new Date(now.getTime() + DROWSY_AWAKE_MINUTES * 60_000).toISOString();
}

export function buildEffectiveLifeScheduleOverlay(
  personaData: unknown,
  now = new Date(),
): string {
  return buildLifeScheduleOverlayForState(
    getPersonaScheduleState(now),
    getActiveRuntimeLifeState(personaData, now),
  );
}

export function shouldSuppressImmediateReplyBySchedule(
  text: string,
  now = new Date(),
): { suppress: boolean; reason?: string; state: ScheduleState } {
  const state = getPersonaScheduleState(now);
  if (state.status !== "asleep") return { suppress: false, state };
  if (isUrgentOrWakeMessage(text)) return { suppress: false, state };
  return { suppress: true, reason: "persona_asleep", state };
}

export function applyIncomingLifeState(
  personaData: unknown,
  text: string,
  now = new Date(),
): {
  suppress: boolean;
  reason?: string;
  state: ScheduleState;
  personaData: Record<string, any>;
  changed: boolean;
} {
  const data = clonePersonaData(personaData);
  const state = getPersonaScheduleState(now);
  const activeRuntime = getActiveRuntimeLifeState(data, now);

  if (state.status !== "asleep") {
    if (getPersonaRuntimeState(data).runtimeLifeState) {
      return {
        suppress: false,
        state,
        personaData: withPersonaRuntimeLifeState(data, null),
        changed: true,
      };
    }
    return { suppress: false, state, personaData: data, changed: false };
  }

  if (activeRuntime) {
    return {
      suppress: false,
      state,
      personaData: withPersonaRuntimeLifeState(data, {
          ...activeRuntime,
          until: drowsyUntil(now),
          reason: "continued_chat",
        } satisfies RuntimeLifeState),
      changed: true,
    };
  }

  if (isUrgentOrWakeMessage(text)) {
    return {
      suppress: false,
      state,
      personaData: withPersonaRuntimeLifeState(data, {
          status: "drowsy_awake",
          startedAt: now.toISOString(),
          until: drowsyUntil(now),
          reason: isWakeMessage(text) ? "wake_message" : "urgent_message",
        } satisfies RuntimeLifeState),
      changed: true,
    };
  }

  return { suppress: true, reason: "persona_asleep", state, personaData: data, changed: false };
}
