import { describe, it, expect } from "vitest";
import { parseVerboseCommand, tryHandleVerboseCommand, getVerboseMode, setVerboseMode } from "./verbose-commands";

describe("parseVerboseCommand", () => {
  it("recognises on commands", () => {
    expect(parseVerboseCommand("详细模式")).toEqual({ kind: "on" });
    expect(parseVerboseCommand("多说一点")).toEqual({ kind: "on" });
    expect(parseVerboseCommand("长回复")).toEqual({ kind: "on" });
    expect(parseVerboseCommand("/verbose")).toEqual({ kind: "on" });
  });

  it("recognises off commands", () => {
    expect(parseVerboseCommand("简洁模式")).toEqual({ kind: "off" });
    expect(parseVerboseCommand("短回复")).toEqual({ kind: "off" });
    expect(parseVerboseCommand("关闭详细")).toEqual({ kind: "off" });
    expect(parseVerboseCommand("/normal")).toEqual({ kind: "off" });
  });

  it("recognises status commands", () => {
    expect(parseVerboseCommand("当前模式")).toEqual({ kind: "status" });
    expect(parseVerboseCommand("回复模式")).toEqual({ kind: "status" });
  });

  it("returns null for normal chat", () => {
    expect(parseVerboseCommand("今天天气怎么样")).toBeNull();
    expect(parseVerboseCommand("你在干嘛")).toBeNull();
    expect(parseVerboseCommand("")).toBeNull();
  });
});

describe("verbose state", () => {
  it("defaults to off", () => {
    expect(getVerboseMode("test:contact:1")).toBe(false);
  });

  it("can be toggled on and off", () => {
    setVerboseMode("test:contact:2", true);
    expect(getVerboseMode("test:contact:2")).toBe(true);
    setVerboseMode("test:contact:2", false);
    expect(getVerboseMode("test:contact:2")).toBe(false);
  });
});

describe("tryHandleVerboseCommand", () => {
  it("returns confirmation when toggling on", () => {
    const reply = tryHandleVerboseCommand("test:contact:3", "详细模式");
    expect(reply).toContain("已开启");
    expect(getVerboseMode("test:contact:3")).toBe(true);
  });

  it("returns confirmation when toggling off", () => {
    setVerboseMode("test:contact:4", true);
    const reply = tryHandleVerboseCommand("test:contact:4", "简洁模式");
    expect(reply).toContain("简洁模式");
    expect(getVerboseMode("test:contact:4")).toBe(false);
  });

  it("returns null for normal chat text", () => {
    expect(tryHandleVerboseCommand("test:contact:5", "你好呀")).toBeNull();
  });
});
