import { describe, expect, it } from "vitest";
import {
  dailyMemoryTitle,
  formatDailyMemoryChatText,
  getDailyMemoryTargetDates,
  parseDailyMemoryResponse,
} from "./daily-memory";

function localDate(year: number, month: number, day: number, hour: number, minute: number) {
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

describe("daily memory", () => {
  it("targets yesterday after the configured morning extraction time", () => {
    const dates = getDailyMemoryTargetDates(localDate(2026, 5, 31, 4, 0), 2);

    expect(dates).toEqual(["2026-05-30", "2026-05-29"]);
  });

  it("does not process the just-finished day before the morning extraction time", () => {
    const dates = getDailyMemoryTargetDates(localDate(2026, 5, 31, 2, 0), 1);

    expect(dates).toEqual(["2026-05-29"]);
  });

  it("formats chat records with time and role labels", () => {
    const text = formatDailyMemoryChatText([
      {
        role: "user",
        content: "今天课好多",
        createdAt: localDate(2026, 5, 30, 21, 5),
      },
      {
        role: "assistant",
        content: "那你晚上早点歇一会。",
        createdAt: localDate(2026, 5, 30, 21, 6),
      },
    ] as any, "王芃泽", 2000);

    expect(text).toContain("21:05 用户：今天课好多");
    expect(text).toContain("21:06 王芃泽：那你晚上早点歇一会。");
  });

  it("parses the LLM JSON result and keeps the stable title available", () => {
    const parsed = parseDailyMemoryResponse(
      '{"shouldRemember":true,"title":"武汉课程很累","description":"敏子今天提到武汉课程安排很满，需要记住他白天会累。","importance":4,"keywords":["武汉","课程"]}',
      "2026-05-30",
    );

    expect(parsed.shouldRemember).toBe(true);
    expect(parsed.title).toBe("武汉课程很累");
    expect(parsed.keywords).toEqual(["武汉", "课程"]);
    expect(parsed.memories?.[0].source).toBe("daily_summary");
    expect(parsed.memories?.[0].memoryType).toBe("daily_summary");
    expect(dailyMemoryTitle("2026-05-30")).toBe("每日记忆 2026-05-30");
  });

  it("parses multiple structured memory cards", () => {
    const parsed = parseDailyMemoryResponse(
      '{"memories":[{"title":"敏子怕敷衍","description":"用户说不喜欢被很快打发去睡觉。","memoryType":"preference","importance":4,"confidence":5,"keywords":["敷衍","睡觉"]},{"title":"异地想念","description":"今天聊到武汉和南京的异地想念。","memoryType":"emotional_moment","importance":4,"confidence":4,"keywords":["武汉","南京"]}]}',
      "2026-05-30",
    );

    expect(parsed.shouldRemember).toBe(true);
    expect(parsed.memories).toHaveLength(2);
    expect(parsed.description).toContain("偏好习惯");
    expect(parsed.keywords).toContain("南京");
  });
});
