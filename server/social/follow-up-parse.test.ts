import { describe, expect, it } from "vitest";
import { parseFollowUpAt } from "./memory-consolidation";
import type { StructuredMemoryCard } from "./memory-card";

const NOW = new Date("2026-06-17T20:00:00+08:00");
const DAY_MS = 86_400_000;

function card(partial: Partial<StructuredMemoryCard>): StructuredMemoryCard {
  return {
    title: "标题",
    description: "描述",
    category: "memory",
    source: "chat",
    memoryType: "open_loop",
    importance: 4,
    confidence: 4,
    keywords: [],
    evidenceMessageIds: [],
    status: "active",
    ...partial,
  };
}

function daysLater(state: Date | null): number | null {
  if (!state) return null;
  return Math.round((state.getTime() - NOW.getTime()) / DAY_MS);
}

describe("parseFollowUpAt", () => {
  it("ignores non open_loop memory types", () => {
    expect(parseFollowUpAt(card({ memoryType: "preference", description: "明天面试" }), NOW)).toBeNull();
  });

  it("reads relative-day phrases", () => {
    expect(daysLater(parseFollowUpAt(card({ description: "明天有面试" }), NOW))).toBe(1);
    expect(daysLater(parseFollowUpAt(card({ description: "后天复查" }), NOW))).toBe(2);
    expect(daysLater(parseFollowUpAt(card({ title: "下周答辩" }), NOW))).toBe(7);
    expect(daysLater(parseFollowUpAt(card({ description: "3天后出结果" }), NOW))).toBe(3);
  });

  it("defaults event keywords without a date to next-day", () => {
    expect(daysLater(parseFollowUpAt(card({ title: "在准备面试", description: "他在准备一场面试" }), NOW))).toBe(1);
  });

  it("returns null when there is no time or event signal", () => {
    expect(parseFollowUpAt(card({ title: "喜欢喝乌龙茶", description: "用户偏好乌龙茶" }), NOW)).toBeNull();
  });
});
