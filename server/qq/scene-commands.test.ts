import { describe, expect, it } from "vitest";
import { parseSceneCommand, getSceneMode, setSceneMode } from "./scene-commands";

describe("parseSceneCommand", () => {
  it("enters scene mode (no background) from various aliases", () => {
    expect(parseSceneCommand("场景模式")).toEqual({ kind: "enter" });
    expect(parseSceneCommand("进入场景")).toEqual({ kind: "enter" });
    expect(parseSceneCommand("沉浸模式")).toEqual({ kind: "enter" });
    expect(parseSceneCommand("情景模式")).toEqual({ kind: "enter" });
    expect(parseSceneCommand("开启旁白")).toEqual({ kind: "enter" });
  });

  it("enters with a named background", () => {
    expect(parseSceneCommand("进入场景 卧室")).toEqual({ kind: "enter", query: "卧室" });
    expect(parseSceneCommand("进入场景2")).toEqual({ kind: "enter", query: "2" });
    expect(parseSceneCommand("切换场景：此刻在一起")).toEqual({ kind: "enter", query: "此刻在一起" });
  });

  it("parses exit commands and aliases", () => {
    expect(parseSceneCommand("退出场景")).toEqual({ kind: "exit" });
    expect(parseSceneCommand("退出场景模式")).toEqual({ kind: "exit" });
    expect(parseSceneCommand("/退出场景")).toEqual({ kind: "exit" });
    expect(parseSceneCommand(" 关闭场景 ")).toEqual({ kind: "exit" });
    expect(parseSceneCommand("退出情景")).toEqual({ kind: "exit" });
    expect(parseSceneCommand("日常模式")).toEqual({ kind: "exit" });
  });

  it("parses list and status commands", () => {
    expect(parseSceneCommand("场景列表")).toEqual({ kind: "list" });
    expect(parseSceneCommand("有哪些场景")).toEqual({ kind: "list" });
    expect(parseSceneCommand("场景")).toEqual({ kind: "status" });
    expect(parseSceneCommand("场景状态")).toEqual({ kind: "status" });
    expect(parseSceneCommand("当前场景")).toEqual({ kind: "status" });
  });

  it("does not hijack normal chat", () => {
    expect(parseSceneCommand("你在吗")).toBeNull();
    expect(parseSceneCommand("我想和你进入一个场景")).toBeNull();
    expect(parseSceneCommand("今天过得怎么样")).toBeNull();
    expect(parseSceneCommand("")).toBeNull();
  });

  it("does not collide with verbose-mode commands", () => {
    expect(parseSceneCommand("详细模式")).toBeNull();
    expect(parseSceneCommand("简洁模式")).toBeNull();
  });
});

describe("scene mode state", () => {
  it("defaults to off", () => {
    expect(getSceneMode("test:contact:1")).toBe(false);
  });

  it("can be toggled on and off", () => {
    setSceneMode("test:contact:2", true);
    expect(getSceneMode("test:contact:2")).toBe(true);
    setSceneMode("test:contact:2", false);
    expect(getSceneMode("test:contact:2")).toBe(false);
  });
});
