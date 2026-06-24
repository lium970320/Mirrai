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
    expect(shouldUsePersonaSourceRecall("那到底是谁", [
      { role: "user", content: "小说里老鹰峡那次发生了什么" },
    ])).toBe(true);
    expect(shouldUsePersonaSourceRecall("具体在哪里", [
      { role: "user", content: "你还记得中考那件事吗" },
    ])).toBe(true);
    expect(shouldUsePersonaSourceRecall("吃饭了吗")).toBe(false);
    expect(shouldUsePersonaSourceRecall("哈哈")).toBe(false);
  });

  it("不把当下亲密/情话误判成原著考据", () => {
    // 回归：一句情话曾因触发词含「喜欢」被锁进原著证据模式，吐出硬编码兜底「对柱子…不能乱编」。
    expect(shouldUsePersonaSourceRecall("喜欢!叔，你身上好香")).toBe(false);
    expect(shouldUsePersonaSourceRecall("好喜欢你")).toBe(false);
    expect(shouldUsePersonaSourceRecall("抱着我")).toBe(false);
    expect(shouldUsePersonaSourceRecall("想跟你睡一块")).toBe(false);
    expect(shouldUsePersonaSourceRecall("亲吻你")).toBe(false);
    // 但带专有名词/回忆词的真原著提问仍要命中
    expect(shouldUsePersonaSourceRecall("柱子后来怎么样了")).toBe(true);
    expect(shouldUsePersonaSourceRecall("你还记得中考那段吗")).toBe(true);
  });

  it("不把当下高频地点/动作词（学校/北京/南京/见面）误判成原著考据", () => {
    // 回归：用户随口「我还在学校呢」含「学校」曾被劫持成原著考据 → 资料库 miss → 兜底「这段我不敢乱说」（2026-06-24 实测）。
    expect(shouldUsePersonaSourceRecall("我还在学校呢")).toBe(false);
    expect(shouldUsePersonaSourceRecall("我在学校")).toBe(false);
    expect(shouldUsePersonaSourceRecall("今天学校好累")).toBe(false);
    expect(shouldUsePersonaSourceRecall("我去北京出差")).toBe(false);
    expect(shouldUsePersonaSourceRecall("南京最近一直下雨")).toBe(false);
    expect(shouldUsePersonaSourceRecall("改天我们见面吧")).toBe(false);
    // 学生时代/原著地点的真提问仍由「中考/考场/初遇/老鹰峡」等更具体的词命中
    expect(shouldUsePersonaSourceRecall("中考考场那段你还记得吗")).toBe(true);
    expect(shouldUsePersonaSourceRecall("老鹰峡那次后来怎么样")).toBe(true);
  });

  it("当下情感冲突/吵架质问不进原著考据（防‘不敢乱说’死循环）", () => {
    // 回归：吵架质问里的通用疑问词（怎么/为什么）+ 前文，曾被当 source follow-up 锁进考据 →
    // 资料库 miss → 反复「这段我不敢乱说」→ 整场吵架死循环（2026-06-23 实测）。
    expect(shouldUsePersonaSourceRecall("你要我怎么相信你", [
      { role: "user", content: "你为什么孤男寡女待在一间房" },
    ])).toBe(false);
    expect(shouldUsePersonaSourceRecall("你是不是出轨了")).toBe(false);
    expect(shouldUsePersonaSourceRecall("你房间里怎么会有女的")).toBe(false);
    expect(shouldUsePersonaSourceRecall("我不信你，你在骗我")).toBe(false);
    // 不误伤：真原著追问仍命中
    expect(shouldUsePersonaSourceRecall("老鹰峡那次后来怎么样")).toBe(true);
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

  it("trims evidence excerpts according to economy limits", () => {
    const context = formatSourceRecallContext([
      {
        id: 1,
        sourceId: 1,
        sourceTitle: "爱人随风而来",
        chapterTitle: "旧事",
        chunkIndex: 5,
        content: "王芃泽在老鹰峡想起很多很长很长的旧事，后面这些文字不应该全部进入省额度提示词。",
        score: 30,
        matchedTerms: ["老鹰峡"],
      },
    ], "老鹰峡那次", { maxExcerptChars: 22 });

    expect(context).toContain("老鹰峡");
    expect(context).toContain("……");
    expect(context).not.toContain("不应该全部进入省额度提示词");
  });
});
