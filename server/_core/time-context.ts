export const BEIJING_TIME_ZONE = "Asia/Shanghai";
export const BEIJING_TIME_ZONE_LABEL = "北京时间（UTC+08:00）";

export type BeijingDayPart = "凌晨" | "清晨" | "上午" | "中午" | "下午" | "晚上" | "深夜";

export const BEIJING_DAY_PARTS: BeijingDayPart[] = ["凌晨", "清晨", "上午", "中午", "下午", "晚上", "深夜"];

export type BeijingTimeParts = {
  year: number;
  month: number;
  day: number;
  weekday: number;
  weekdayName: string;
  hour: number;
  minute: number;
  minuteOfDay: number;
  dateKey: string;
  timeKey: string;
  dayPart: BeijingDayPart;
  timeZone: typeof BEIJING_TIME_ZONE;
  timeZoneLabel: typeof BEIJING_TIME_ZONE_LABEL;
  display: string;
};

const BEIJING_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  timeZone: BEIJING_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "long",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const WEEKDAY_NAMES = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function partValue(parts: Intl.DateTimeFormatPart[], type: string): string {
  return parts.find(part => part.type === type)?.value ?? "";
}

export function getBeijingDayPartForMinute(minuteOfDay: number): BeijingDayPart {
  if (minuteOfDay < 5 * 60) return "凌晨";
  if (minuteOfDay < 8 * 60) return "清晨";
  if (minuteOfDay < 11 * 60) return "上午";
  if (minuteOfDay < 13 * 60) return "中午";
  if (minuteOfDay < 18 * 60) return "下午";
  if (minuteOfDay < 22 * 60) return "晚上";
  return "深夜";
}

export function getBeijingTimeParts(now = new Date()): BeijingTimeParts {
  const parts = BEIJING_FORMATTER.formatToParts(now);
  const year = Number(partValue(parts, "year"));
  const month = Number(partValue(parts, "month"));
  const day = Number(partValue(parts, "day"));
  const rawHour = Number(partValue(parts, "hour"));
  const hour = rawHour === 24 ? 0 : rawHour;
  const minute = Number(partValue(parts, "minute"));
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const weekdayName = partValue(parts, "weekday") || WEEKDAY_NAMES[weekday];
  const minuteOfDay = hour * 60 + minute;
  const dateKey = `${year}-${pad2(month)}-${pad2(day)}`;
  const timeKey = `${pad2(hour)}:${pad2(minute)}`;
  const dayPart = getBeijingDayPartForMinute(minuteOfDay);

  return {
    year,
    month,
    day,
    weekday,
    weekdayName,
    hour,
    minute,
    minuteOfDay,
    dateKey,
    timeKey,
    dayPart,
    timeZone: BEIJING_TIME_ZONE,
    timeZoneLabel: BEIJING_TIME_ZONE_LABEL,
    display: `${dateKey} ${weekdayName} ${timeKey}（${dayPart}，${BEIJING_TIME_ZONE_LABEL}）`,
  };
}

export function formatBeijingDateTime(now = new Date()): string {
  return getBeijingTimeParts(now).display;
}

export function getBeijingDateKey(now = new Date()): string {
  return getBeijingTimeParts(now).dateKey;
}

export function getBeijingTimeKey(now = new Date()): string {
  return getBeijingTimeParts(now).timeKey;
}

export function getBeijingMinuteOfDay(now = new Date()): number {
  return getBeijingTimeParts(now).minuteOfDay;
}
