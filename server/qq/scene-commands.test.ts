import { describe, expect, it } from "vitest";
import { parseSceneCommand } from "./scene-commands";

describe("parseSceneCommand", () => {
  it("parses exit commands", () => {
    expect(parseSceneCommand("退出场景")).toEqual({ kind: "exit" });
    expect(parseSceneCommand("退出场景模式")).toEqual({ kind: "exit" });
    expect(parseSceneCommand("/退出场景")).toEqual({ kind: "exit" });
    expect(parseSceneCommand(" 关闭场景 ")).toEqual({ kind: "exit" });
  });

  it("parses list commands", () => {
    expect(parseSceneCommand("场景")).toEqual({ kind: "list" });
    expect(parseSceneCommand("场景列表")).toEqual({ kind: "list" });
    expect(parseSceneCommand("进入场景")).toEqual({ kind: "list" });
  });

  it("parses enter commands with a query", () => {
    expect(parseSceneCommand("进入场景 卧室")).toEqual({ kind: "enter", query: "卧室" });
    expect(parseSceneCommand("切换场景：此刻在一起")).toEqual({ kind: "enter", query: "此刻在一起" });
    expect(parseSceneCommand("进入场景2")).toEqual({ kind: "enter", query: "2" });
  });

  it("does not hijack normal chat", () => {
    expect(parseSceneCommand("你在吗")).toBeNull();
    expect(parseSceneCommand("我想和你进入一个场景")).toBeNull();
    expect(parseSceneCommand("今天过得怎么样")).toBeNull();
    expect(parseSceneCommand("")).toBeNull();
  });
});
