import { describe, expect, it } from "vitest";
import { parseStructuredMemoryCardsResponse, structuredMemoryToInsert } from "./memory-card";

describe("structured memory cards", () => {
  it("parses memory card JSON and applies safe defaults", () => {
    const cards = parseStructuredMemoryCardsResponse(JSON.stringify({
      memories: [
        {
          title: "武汉课程很累",
          description: "敏子说今天在武汉上课很累，以后晚上聊天要记得他白天可能消耗很大。",
          memoryType: "user_fact",
          importance: 4,
          confidence: 5,
          keywords: ["武汉", "课程", "累"],
        },
      ],
    }), {
      date: "2026-05-30",
      source: "daily_summary",
      memoryType: "daily_summary",
    });

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      title: "武汉课程很累",
      source: "daily_summary",
      memoryType: "user_fact",
      importance: 4,
      confidence: 5,
      date: "2026-05-30",
    });
  });

  it("converts a structured card into an insertable memory row", () => {
    const [card] = parseStructuredMemoryCardsResponse('{"title":"记住称呼","description":"用户喜欢被叫敏子。","memoryType":"preference","keywords":["敏子"]}');
    const insert = structuredMemoryToInsert(card, 12, 34);

    expect(insert.personaId).toBe(12);
    expect(insert.userId).toBe(34);
    expect(insert.memoryType).toBe("preference");
    expect(insert.keywords).toEqual(["敏子"]);
  });
});
