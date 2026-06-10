import { describe, expect, it } from "vitest";
import { formatMemoryRecallContext } from "./memory-recall";

describe("persona memory recall", () => {
  it("formats long-term memories as a compact prompt section", () => {
    const context = formatMemoryRecallContext([
      {
        id: 1,
        title: "每日记忆 2026-05-30",
        description: "敏子说今天在武汉纺织大学上课很累，王芃泽需要记住他在武汉、自己在南京，聊天时不要写成同城。",
        category: "memory",
        date: "2026-05-30",
        source: "daily_summary",
        memoryType: "user_fact",
        importance: 4,
        confidence: 5,
        keywords: ["武汉", "南京"],
        createdAt: new Date("2026-05-31T03:20:00"),
      },
    ]);

    expect(context).toContain("长期关系记忆");
    expect(context).toContain("用户事实");
    expect(context).toContain("每日整理");
    expect(context).toContain("武汉纺织大学");
    expect(context).toContain("当前用户/敏子是男性");
    expect(context).toContain("记住他在武汉");
    expect(context).not.toContain("记住她在武汉");
    expect(context).toContain("不要机械复述");
  });

  it("trims memory descriptions according to economy limits", () => {
    const context = formatMemoryRecallContext([
      {
        id: 1,
        title: "很长的关系记忆",
        description: "敏子在武汉上课，王芃泽在南京工作，这段记忆写得非常长，用来确认省额度模式下不会把整段描述都塞进提示词里。",
        category: "memory",
        date: "2026-05-30",
        source: "daily_summary",
        memoryType: "relationship_event",
        importance: 4,
        confidence: 5,
        keywords: ["武汉", "南京"],
        createdAt: new Date("2026-05-31T03:20:00"),
      },
    ], { maxDescriptionChars: 24 });

    expect(context).toContain("敏子在武汉上课");
    expect(context).toContain("...");
    expect(context).not.toContain("不会把整段描述都塞进提示词里");
  });
});
