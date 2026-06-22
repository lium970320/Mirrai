import type { SelfieCooldown } from "./selfie-decision";

/**
 * 自拍冷却的轻量内存状态（按 contactId）。只为防止短时间内狂发自拍，
 * 不需要持久化——进程重启后重置无大碍（3 小时间隔/当日上限的限制仍在当次进程内生效）。
 * 明确指令（"发自拍"）不受冷却限制，由 decideSelfieOpportunity 单独处理。
 */

type Entry = { lastAt: string; day: string; count: number };

const store = new Map<string, Entry>();

function dayKey(now: Date): string {
  // 用北京时区的日界（UTC+8）粗略归日，避免按 UTC 把晚上算到次日。
  return new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
}

export function getSelfieCooldown(contactId: string, now = new Date()): SelfieCooldown {
  const entry = store.get(contactId);
  if (!entry) return {};
  const today = dayKey(now);
  return { lastAt: entry.lastAt, countToday: entry.day === today ? entry.count : 0 };
}

export function recordSelfieSent(contactId: string, now = new Date()): void {
  const today = dayKey(now);
  const entry = store.get(contactId);
  const count = entry && entry.day === today ? entry.count + 1 : 1;
  store.set(contactId, { lastAt: now.toISOString(), day: today, count });
}

// 仅供测试使用：清空冷却状态。
export function __resetSelfieCooldownForTest(): void {
  store.clear();
}
