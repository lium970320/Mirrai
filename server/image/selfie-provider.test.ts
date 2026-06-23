import { describe, expect, it } from "vitest";
import { buildPhotoPrompt, pickGeneratedImage, pickGeneratedImageFromDir } from "./selfie-provider";

describe("pickGeneratedImage（首选：pusher 结果列表）", () => {
  const isRefCopy = (p: string) => p.includes("refcopy");

  it("排除参考图副本，取最后一张真生成图", () => {
    expect(pickGeneratedImage(["/a/refcopy.png", "/a/gen1.png", "/a/gen2.png"], isRefCopy)).toBe("/a/gen2.png");
  });

  it("列表里只有参考图副本/为空时返回 undefined（交给目录扫描兜底）", () => {
    expect(pickGeneratedImage(["/a/refcopy.png"], isRefCopy)).toBeUndefined();
    expect(pickGeneratedImage([], isRefCopy)).toBeUndefined();
  });
});

describe("pickGeneratedImageFromDir（兜底：扫下载目录）", () => {
  const baseSize = 4203281; // 参考图大小（与基准脸相同的副本要排除）
  const since = 1000;

  it("挑本次运行后产生、非参考图大小、最新的一张", () => {
    const files = [
      { path: "/d/old-real.png", size: 1900000, mtimeMs: 500 }, // 本次运行之前，排除
      { path: "/d/refcopy.png", size: baseSize, mtimeMs: 1500 }, // 参考图大小，排除
      { path: "/d/gen-early.png", size: 1850000, mtimeMs: 1200 }, // 真生成，较早
      { path: "/d/gen-late.png", size: 1990000, mtimeMs: 1800 }, // 真生成，最新 → 选它
    ];
    expect(pickGeneratedImageFromDir(files, [baseSize], since)).toBe("/d/gen-late.png");
  });

  it("只有参考图副本或旧图时返回 undefined", () => {
    const files = [
      { path: "/d/refcopy.png", size: baseSize, mtimeMs: 1500 },
      { path: "/d/old.png", size: 1900000, mtimeMs: 500 },
    ];
    expect(pickGeneratedImageFromDir(files, [baseSize], since)).toBeUndefined();
  });

  it("无参考图（空集）时不按大小排除", () => {
    const files = [{ path: "/d/gen.png", size: 1900000, mtimeMs: 1800 }];
    expect(pickGeneratedImageFromDir(files, [], since)).toBe("/d/gen.png");
  });
});

describe("buildPhotoPrompt（多态附图措辞）", () => {
  it("带人+在家 → 两图措辞，人物与环境双约束都在", () => {
    const p = buildPhotoPrompt({ prompt: "在沙发上看手机", includeFace: true, atHome: true });
    expect(p).toContain("两张图");
    expect(p).toContain("同一个人");
    expect(p).toContain("同一个地方");
  });

  it("只带人 → 单人措辞，不禁人、无环境约束", () => {
    const p = buildPhotoPrompt({ prompt: "笑", includeFace: true });
    expect(p).toContain("同一个人");
    expect(p).not.toContain("同一个地方");
    expect(p).not.toContain("不要出现任何人物");
  });

  it("只在家（不带人）→ 环境措辞 + 禁止任何人入镜（防陌生人）", () => {
    const p = buildPhotoPrompt({ prompt: "厨房", atHome: true });
    expect(p).toContain("同一个地方");
    expect(p).not.toContain("同一个人");
    expect(p).toContain("不要出现任何人物");
  });

  it("都不带 → 纯文生图，无参考图约束", () => {
    const p = buildPhotoPrompt({ prompt: "一碗热汤面" });
    expect(p).toContain("生成一张写实照片");
    expect(p).not.toContain("参考");
  });
});
