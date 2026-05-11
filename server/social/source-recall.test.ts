import { describe, expect, it } from "vitest";
import {
  formatSourceRecallContext,
  formatSourceRecallMissContext,
  shouldUsePersonaSourceRecall,
} from "./source-recall";

describe("persona source recall", () => {
  it("only triggers on memory or source-specific messages", () => {
    expect(shouldUsePersonaSourceRecall("叔，你还记得老鹰峡那次吗")).toBe(true);
    expect(shouldUsePersonaSourceRecall("小说里你第一次见柱子是什么时候")).toBe(true);
    expect(shouldUsePersonaSourceRecall("中考的时候我们是不是睡一块")).toBe(true);
    expect(shouldUsePersonaSourceRecall("原文里这个细节是什么")).toBe(true);
    expect(shouldUsePersonaSourceRecall("你再想想，当时具体的情形不是这样的")).toBe(false);
    expect(shouldUsePersonaSourceRecall("你再想想，当时具体的情形不是这样的", [
      { role: "user", content: "你还记得老鹰峡那次吗" },
    ])).toBe(true);
    expect(shouldUsePersonaSourceRecall("吃饭了吗")).toBe(false);
    expect(shouldUsePersonaSourceRecall("哈哈")).toBe(false);
  });

  it("formats recalled chunks as roleplay-only source context", () => {
    const context = formatSourceRecallContext([
      {
        id: 1,
        sourceId: 1,
        sourceTitle: "爱人随风而来",
        chapterTitle: "老鹰峡",
        chunkIndex: 12,
        content: "王芃泽和柱子在老鹰峡经历了一段危险的路。",
        score: 20,
        matchedTerms: ["老鹰峡"],
      },
    ]);

    expect(context).toContain("原著资料库检索");
    expect(context).toContain("不要说“资料库”");
    expect(context).toContain("老鹰峡");
    expect(context).toContain("原文片段");
    expect(context).toContain("只说确定的部分");
    expect(context).toContain("不要猜一个具体名词");
    expect(context).toContain("不要顺着继续讲后续剧情");
  });

  it("formats no-hit recall as a strict no-invention context", () => {
    const context = formatSourceRecallMissContext("小说里这个细节到底在哪里");

    expect(context).toContain("没有命中足以回答");
    expect(context).toContain("不要使用人物长背景");
    expect(context).toContain("记不准");
    expect(context).toContain("回复保持短");
  });

  it("cuts long evidence around matched terms instead of only chunk start", () => {
    const prefix = "前文".repeat(420);
    const context = formatSourceRecallContext([
      {
        id: 1,
        sourceId: 1,
        sourceTitle: "爱人随风而来",
        chapterTitle: "旧事",
        chunkIndex: 99,
        content: `${prefix}中考那年考场外很热，他还记得那件事。`,
        score: 30,
        matchedTerms: ["中考", "考场"],
      },
    ]);

    expect(context).toContain("……");
    expect(context).toContain("中考那年考场外很热");
  });
});
