import { describe, expect, it } from "vitest";
import { formatMemoryRecallContext } from "./memory-recall";

function mem(description: string): any {
  return {
    id: 1,
    title: "记忆",
    description,
    category: "memory",
    date: null,
    memoryType: "relationship_event",
    importance: 4,
    confidence: 4,
    createdAt: new Date(),
  };
}

describe("memory recall pronoun override gating", () => {
  it("rewrites the legacy 敏子/她→他 for the default male user (behavior-preserving)", () => {
    const out = formatMemoryRecallContext([mem("敏子今天很想她")], {});
    expect(out).toContain("想他");
    expect(out).not.toContain("想她");
  });

  it("skips the original-specific rewrite for a non-male-user persona", () => {
    const out = formatMemoryRecallContext([mem("敏子今天很想她")], { userPronoun: "她" });
    expect(out).toContain("想她");
  });
});
