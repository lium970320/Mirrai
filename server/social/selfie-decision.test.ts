import { describe, expect, it } from "vitest";
import { decideSelfieOpportunity, isSelfieCooldownActive, parseEnvironmentRequest } from "./selfie-decision";

describe("isSelfieCooldownActive", () => {
  const now = new Date("2026-06-23T12:00:00+08:00");
  it("当日已发 2 张则冷却", () => {
    expect(isSelfieCooldownActive({ countToday: 2 }, now)).toBe(true);
  });
  it("距上次不足 3 小时则冷却", () => {
    expect(isSelfieCooldownActive({ lastAt: new Date(now.getTime() - 60 * 60 * 1000).toISOString() }, now)).toBe(true);
  });
  it("距上次超过 3 小时、当日未超额则不冷却", () => {
    expect(isSelfieCooldownActive({ lastAt: new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString(), countToday: 1 }, now)).toBe(false);
  });
  it("从未发过则不冷却", () => {
    expect(isSelfieCooldownActive({}, now)).toBe(false);
  });
});

describe("decideSelfieOpportunity（缩成只判断明确指令）", () => {
  it("明确要自拍→必发、kind=selfie、带情境", () => {
    const d = decideSelfieOpportunity({ inputText: "发张自拍 在公园" });
    expect(d.shouldSend).toBe(true);
    expect(d.kind).toBe("selfie");
    expect(d.reason).toBe("explicit_request");
    expect(d.situation).toBe("在公园");
  });

  it("明确要拍环境→必发、kind=environment（含放宽后的口语）", () => {
    expect(decideSelfieOpportunity({ inputText: "拍一下家里的样子" }).kind).toBe("environment");
    expect(decideSelfieOpportunity({ inputText: "看看你那边" }).kind).toBe("environment");
    expect(decideSelfieOpportunity({ inputText: "拍个家里看看" }).kind).toBe("environment");
    expect(decideSelfieOpportunity({ inputText: "想看看你卧室" }).kind).toBe("environment");
    expect(decideSelfieOpportunity({ inputText: "拍张外面" }).kind).toBe("environment");
  });

  it("不误吃「问外面情况」类（外面/窗外只认拍/发紧邻）", () => {
    expect(decideSelfieOpportunity({ inputText: "看外面下雨没" }).shouldSend).toBe(false);
    expect(decideSelfieOpportunity({ inputText: "我想看看外面" }).shouldSend).toBe(false);
    expect(decideSelfieOpportunity({ inputText: "你看外面" }).shouldSend).toBe(false);
  });

  it("没有明确指令→不发（自然想拍交给 LLM 的 [[PHOTO]] 标记）", () => {
    expect(decideSelfieOpportunity({ inputText: "你在干嘛呢" }).shouldSend).toBe(false);
    expect(decideSelfieOpportunity({ inputText: "今天好累" }).shouldSend).toBe(false);
  });
});

describe("parseEnvironmentRequest（直接）", () => {
  it("强场景词宽前缀命中", () => {
    expect(parseEnvironmentRequest("拍个家里看看")).not.toBeNull();
    expect(parseEnvironmentRequest("想看看你卧室")).not.toBeNull();
    expect(parseEnvironmentRequest("你家什么样")).not.toBeNull();
  });

  it("外面/窗外只认拍/发紧邻，拒绝看/想看", () => {
    expect(parseEnvironmentRequest("拍张外面")).not.toBeNull();
    expect(parseEnvironmentRequest("看外面下雨没")).toBeNull();
    expect(parseEnvironmentRequest("我想看看外面")).toBeNull();
  });

  it("situation 是去空格后的规范化原文", () => {
    expect(parseEnvironmentRequest("拍 一下 家里")?.situation).toBe("拍一下家里");
  });
});
