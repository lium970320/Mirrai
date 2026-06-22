import { describe, expect, it } from "vitest";
import { decideSelfieOpportunity, isLocationQuery, isSelfieCooldownActive } from "./selfie-decision";

describe("isLocationQuery", () => {
  it("识别在哪/在干嘛类提问", () => {
    expect(isLocationQuery("你在哪")).toBe(true);
    expect(isLocationQuery("你现在在干嘛")).toBe(true);
    expect(isLocationQuery("你那边怎样")).toBe(true);
    expect(isLocationQuery("今天吃了吗")).toBe(false);
    expect(isLocationQuery("我爱你")).toBe(false);
  });
});

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

  it("明确要拍环境→必发、kind=environment", () => {
    expect(decideSelfieOpportunity({ inputText: "拍一下家里的样子" }).kind).toBe("environment");
    expect(decideSelfieOpportunity({ inputText: "看看你那边" }).kind).toBe("environment");
  });

  it("没有明确指令→不发（自然想拍交给 LLM 的 [[PHOTO]] 标记）", () => {
    expect(decideSelfieOpportunity({ inputText: "你在干嘛呢" }).shouldSend).toBe(false);
    expect(decideSelfieOpportunity({ inputText: "今天好累" }).shouldSend).toBe(false);
  });
});
