import { describe, expect, it } from "vitest";
import { decideMemoryGovernance } from "./memory-governance";
import type { StructuredMemoryCard } from "./memory-card";

function card(overrides: Partial<StructuredMemoryCard> = {}): StructuredMemoryCard {
  return {
    title: "敏子不喜欢被催睡",
    description: "用户明确说不喜欢每次聊天都被很快催去睡觉，之后回复要先回应他的话。",
    category: "memory",
    source: "chat",
    memoryType: "preference",
    importance: 4,
    confidence: 4,
    keywords: ["催睡", "敷衍", "睡觉"],
    evidenceMessageIds: [1, 2],
    status: "active",
    ...overrides,
  };
}

describe("memory governance", () => {
  it("skips a duplicate active memory", () => {
    const decision = decideMemoryGovernance(card(), [
      {
        id: 10,
        title: "敏子不喜欢被催睡",
        description: "用户说过不喜欢被催睡。",
        category: "memory",
        date: null,
        messageId: null,
        personaId: 1,
        userId: 1,
        source: "chat",
        memoryType: "preference",
        importance: 4,
        confidence: 4,
        keywords: ["催睡", "睡觉"],
        emotion: null,
        validFrom: null,
        validTo: null,
        lastAccessedAt: null,
        evidenceMessageIds: null,
        status: "active",
        createdAt: new Date(),
      },
    ]);

    expect(decision.action).toBe("skip_duplicate");
    expect(decision.duplicateOf).toBe(10);
  });

  it("marks conflicting old memory as contradicted when the new card is stronger", () => {
    const decision = decideMemoryGovernance(card({
      title: "敏子现在在南京",
      description: "用户明确说他已经不在武汉上课了，现在在南京。",
      memoryType: "user_fact",
      keywords: ["南京", "位置"],
      importance: 5,
      confidence: 5,
    }), [
      {
        id: 11,
        title: "敏子在武汉上课",
        description: "用户之前说他在武汉纺织大学上课。",
        category: "memory",
        date: null,
        messageId: null,
        personaId: 1,
        userId: 1,
        source: "daily_summary",
        memoryType: "user_fact",
        importance: 4,
        confidence: 4,
        keywords: ["武汉", "位置"],
        emotion: null,
        validFrom: null,
        validTo: null,
        lastAccessedAt: null,
        evidenceMessageIds: null,
        status: "active",
        createdAt: new Date(),
      },
    ]);

    expect(decision.action).toBe("create");
    expect(decision.contradictIds).toEqual([11]);
  });

  it("archives an open loop when a related new memory resolves it", () => {
    const decision = decideMemoryGovernance(card({
      title: "冷漠问题已经和好",
      description: "用户和角色聊清楚了上次被敷衍的委屈，角色之后要先接住他的话。",
      memoryType: "conflict",
      keywords: ["冷漠", "敷衍", "和好"],
    }), [
      {
        id: 12,
        title: "需要处理冷漠敷衍问题",
        description: "用户还在意角色总是把话题推去睡觉，后续要认真回应。",
        category: "memory",
        date: null,
        messageId: null,
        personaId: 1,
        userId: 1,
        source: "chat",
        memoryType: "open_loop",
        importance: 4,
        confidence: 4,
        keywords: ["冷漠", "敷衍"],
        emotion: null,
        validFrom: null,
        validTo: null,
        lastAccessedAt: null,
        evidenceMessageIds: null,
        status: "active",
        createdAt: new Date(),
      },
    ]);

    expect(decision.action).toBe("create");
    expect(decision.archiveIds).toEqual([12]);
  });
});
