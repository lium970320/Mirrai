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

describe("decideSelfieOpportunity", () => {
  const now = new Date("2026-06-23T20:00:00+08:00");
  const base = { availability: "open", cooldown: {}, now } as const;

  it("明确要→必发，不受冷却限制", () => {
    const d = decideSelfieOpportunity({ ...base, inputText: "发张自拍 在公园", cooldown: { countToday: 5 } });
    expect(d.shouldSend).toBe(true);
    expect(d.kind).toBe("selfie");
    expect(d.reason).toBe("explicit_request");
    expect(d.situation).toBe("在公园");
  });

  it("明确拍环境→environment，不受冷却限制", () => {
    const d = decideSelfieOpportunity({ ...base, inputText: "拍一下家里的样子", cooldown: { countToday: 5 } });
    expect(d.shouldSend).toBe(true);
    expect(d.kind).toBe("environment");
    expect(d.reason).toBe("explicit_request");
    const d2 = decideSelfieOpportunity({ ...base, inputText: "看看你那边" });
    expect(d2.kind).toBe("environment");
  });

  it("问在哪→按概率（random<0.4 发，否则不发）", () => {
    const yes = decideSelfieOpportunity({ ...base, inputText: "你在干嘛呢", random: () => 0.2 });
    expect(yes.shouldSend).toBe(true);
    expect(yes.reason).toBe("location_query");
    const no = decideSelfieOpportunity({ ...base, inputText: "你在干嘛呢", random: () => 0.9 });
    expect(no.shouldSend).toBe(false);
  });

  it("空闲时段自主低概率（random<0.08 发）", () => {
    const yes = decideSelfieOpportunity({ ...base, inputText: "今天好累", random: () => 0.05 });
    expect(yes.shouldSend).toBe(true);
    expect(yes.reason).toBe("spontaneous");
    const no = decideSelfieOpportunity({ ...base, inputText: "今天好累", random: () => 0.5 });
    expect(no.shouldSend).toBe(false);
  });

  it("睡眠时段不做概率/自主触发", () => {
    const d = decideSelfieOpportunity({ ...base, availability: "silent_unless_urgent", inputText: "你在哪", random: () => 0.01 });
    expect(d.shouldSend).toBe(false);
  });

  it("冷却内不做概率/自主触发", () => {
    const d = decideSelfieOpportunity({ ...base, inputText: "你在哪", cooldown: { countToday: 2 }, random: () => 0.01 });
    expect(d.shouldSend).toBe(false);
  });
});
