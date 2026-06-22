import { describe, expect, it } from "vitest";
import {
  buildSourceGroundingRewriteMessages,
  isUnhelpfulSourceRecallReply,
  sourceRecallFallbackReply,
  sourceGroundedLlmOptions,
  withSourceGroundingInstruction,
} from "./source-grounding";

describe("source grounding", () => {
  it("adds short evidence-only instructions only when source context exists", () => {
    expect(withSourceGroundingInstruction("你好", "")).toBe("你好");

    const instruction = withSourceGroundingInstruction("你还记得中考吗", "内部证据");

    expect(instruction).toContain("原文回忆答复约束");
    expect(instruction).toContain("1-3 句");
    expect(instruction).toContain("不要顺着继续讲后续剧情");
    expect(instruction).toContain("不要用大致剧情");
  });

  it("builds a rewrite prompt that removes unsupported details", () => {
    const messages = buildSourceGroundingRewriteMessages({
      personaName: "王芃泽",
      userQuestion: "当时在哪里",
      sourceContext: "原文片段：只写到考场外很热。",
      draftReply: "在考场外，后来我们还一起去了湖边。",
    });
    const joined = messages.map(message => message.content).join("\n");

    expect(joined).toContain("内部证据没有明确支持");
    expect(joined).toContain("必须删除");
    expect(joined).toContain("最终回复优先 1-3 句");
    expect(joined).toContain("只输出最终可发送");
  });

  it("bounds source recall LLM options", () => {
    expect(sourceGroundedLlmOptions({ temperature: 0.9, maxTokens: 1200 })).toMatchObject({
      temperature: 0.25,
      maxTokens: 480,
    });
    expect(sourceGroundedLlmOptions({ provider: "DeepSeek" })).toMatchObject({
      provider: "DeepSeek",
      temperature: 0.25,
      maxTokens: 480,
    });
    expect(sourceGroundedLlmOptions({ maxTokens: 1200 }, 320)).toMatchObject({
      temperature: 0.25,
      maxTokens: 320,
    });
  });

  it("uses a source-specific fallback instead of the generic presence reply", () => {
    const fallback = sourceRecallFallbackReply("你爱柱子吗");

    expect(fallback).toContain("不能拿一句“我在”糊弄你");
    expect(fallback).toContain("柱子");
    expect(isUnhelpfulSourceRecallReply("我在。")).toBe(true);
    expect(isUnhelpfulSourceRecallReply(fallback)).toBe(false);
  });

  it("honors a persona-level source fallback override", () => {
    const override = sourceRecallFallbackReply("你还想着阿哲吗", {
      sourceFallbackTrigger: "阿哲",
      sourceFallbackReply: "阿哲那段我得照实说，记不准的不编。",
    });
    expect(override).toBe("阿哲那段我得照实说，记不准的不编。");

    // 自定义触发下，旧的「柱子」问句改走通用兜底，不再误命中专属文案。
    const generic = sourceRecallFallbackReply("你爱柱子吗", {
      sourceFallbackTrigger: "阿哲",
      sourceFallbackReply: "阿哲那段我得照实说。",
    });
    expect(generic).toContain("我不敢乱说");
  });
});
