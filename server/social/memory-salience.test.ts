import { describe, expect, it } from "vitest";
import { scoreMemory, type PersonaMemoryRecallOptions } from "./memory-recall";

const DAY_MS = 86_400_000;
const opts: PersonaMemoryRecallOptions = { personaId: 1, userId: 1, messageText: "考试" };
const terms = ["考试"];

function mem(partial: Record<string, unknown>): any {
  return {
    id: 1,
    title: "考试",
    description: "关于考试",
    category: "memory",
    date: null,
    memoryType: "relationship_event",
    importance: 3,
    confidence: 4,
    status: "active",
    createdAt: new Date(),
    ...partial,
  };
}

describe("memory salience", () => {
  it("ranks recent important memories above old trivial ones with the same match", () => {
    const recentImportant = scoreMemory(mem({ importance: 5, createdAt: new Date() }), terms, opts);
    const oldTrivial = scoreMemory(mem({ importance: 2, createdAt: new Date(Date.now() - 60 * DAY_MS) }), terms, opts);
    expect(recentImportant).toBeGreaterThan(oldTrivial);
  });

  it("gives a recency bonus to recently accessed memories", () => {
    const fresh = scoreMemory(mem({ lastAccessedAt: new Date() }), terms, opts);
    const stale = scoreMemory(mem({ importance: 2, lastAccessedAt: new Date(Date.now() - 60 * DAY_MS) }), terms, opts);
    expect(fresh).toBeGreaterThan(stale);
  });

  it("does not penalize high-importance memories even when old", () => {
    const oldImportant = scoreMemory(mem({ importance: 5, createdAt: new Date(Date.now() - 120 * DAY_MS) }), terms, opts);
    const recentImportant = scoreMemory(mem({ importance: 5, createdAt: new Date() }), terms, opts);
    // 仅相差近期奖励（1 分），老的高重要度不被显著性扣分。
    expect(recentImportant - oldImportant).toBeLessThanOrEqual(1);
  });
});
