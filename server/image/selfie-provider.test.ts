import { describe, expect, it } from "vitest";
import { pickGeneratedImage, pickGeneratedImageFromDir } from "./selfie-provider";

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
    expect(pickGeneratedImageFromDir(files, baseSize, since)).toBe("/d/gen-late.png");
  });

  it("只有参考图副本或旧图时返回 undefined", () => {
    const files = [
      { path: "/d/refcopy.png", size: baseSize, mtimeMs: 1500 },
      { path: "/d/old.png", size: 1900000, mtimeMs: 500 },
    ];
    expect(pickGeneratedImageFromDir(files, baseSize, since)).toBeUndefined();
  });

  it("基准脸缺失（baseSize<=0）时不按大小排除", () => {
    const files = [{ path: "/d/gen.png", size: 1900000, mtimeMs: 1800 }];
    expect(pickGeneratedImageFromDir(files, -1, since)).toBe("/d/gen.png");
  });
});
