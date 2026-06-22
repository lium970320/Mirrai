import { describe, expect, it } from "vitest";
import { parseSelfieCommand } from "./selfie-commands";
import { buildSelfiePrompt, lightingForMinute, sceneForScheduleCategory, pickGeneratedImage } from "../image/selfie-provider";

describe("parseSelfieCommand", () => {
  it("识别基本自拍指令（无情境）", () => {
    expect(parseSelfieCommand("自拍")).toEqual({ situation: "" });
    expect(parseSelfieCommand("发张自拍")).toEqual({ situation: "" });
    expect(parseSelfieCommand("你发张自拍")).toEqual({ situation: "" });
    expect(parseSelfieCommand("来张自拍")).toEqual({ situation: "" });
    expect(parseSelfieCommand("拍张照")).toEqual({ situation: "" });
    expect(parseSelfieCommand("/自拍")).toEqual({ situation: "" });
  });

  it("带情境", () => {
    expect(parseSelfieCommand("发张自拍 在咖啡馆")).toEqual({ situation: "在咖啡馆" });
    expect(parseSelfieCommand("拍张照：在公园散步")).toEqual({ situation: "在公园散步" });
    expect(parseSelfieCommand("给我来张自拍，刚下班")).toEqual({ situation: "刚下班" });
  });

  it("不误吃正常聊天", () => {
    expect(parseSelfieCommand("今天过得怎么样")).toBeNull();
    expect(parseSelfieCommand("我想看看你")).toBeNull();
    expect(parseSelfieCommand("来个拥抱")).toBeNull();
    expect(parseSelfieCommand("照顾好自己")).toBeNull();
    expect(parseSelfieCommand("发个消息给我")).toBeNull();
    expect(parseSelfieCommand("")).toBeNull();
  });
});

describe("buildSelfiePrompt", () => {
  it("空情境用默认场景", () => {
    const prompt = buildSelfiePrompt("");
    expect(prompt).toContain("参考所附的这张脸");
    expect(prompt).toContain("同一个人");
  });

  it("注入给定情境并保留一致性约束", () => {
    const prompt = buildSelfiePrompt("傍晚在厨房做饭");
    expect(prompt).toContain("傍晚在厨房做饭");
    expect(prompt).toContain("同一个人");
    expect(prompt).toContain("写实");
  });
});

describe("自拍锚定作息（时间/光线/场景）", () => {
  it("深夜昏暗、白天明亮", () => {
    expect(lightingForMinute(60)).toContain("昏暗");
    expect(lightingForMinute(1380)).toContain("昏暗");
    expect(lightingForMinute(720)).toContain("明亮");
  });

  it("睡眠时段默认在床上，工作时段在工位", () => {
    expect(sceneForScheduleCategory("sleep", "sleeping")).toContain("床");
    expect(sceneForScheduleCategory("work", "working_morning")).toContain("工位");
  });

  it("带作息上下文时提示词锚定此刻时间/光线/场景", () => {
    const ctx = { timeLabel: "23:30", dayPart: "深夜", lightingHint: "深夜，光线昏暗", defaultScene: "在卧室床上" };
    const prompt = buildSelfiePrompt("", ctx);
    expect(prompt).toContain("23:30");
    expect(prompt).toContain("昏暗");
    expect(prompt).toContain("在卧室床上");
  });
});

describe("pickGeneratedImage（排除参考图副本）", () => {
  const isRef = (p: string) => p.includes("ref");

  it("排除参考图副本，取最后一张生成图", () => {
    expect(pickGeneratedImage(["E:/ref.png", "E:/gen1.png", "E:/gen2.png"], isRef)).toBe("E:/gen2.png");
    expect(pickGeneratedImage(["E:/ref.png", "E:/gen1.png"], isRef)).toBe("E:/gen1.png");
  });

  it("只有参考图或空列表时返回 undefined（退回文字而非发原图）", () => {
    expect(pickGeneratedImage(["E:/ref.png"], isRef)).toBeUndefined();
    expect(pickGeneratedImage([], isRef)).toBeUndefined();
  });
});
