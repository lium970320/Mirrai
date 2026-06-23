import { describe, expect, it } from "vitest";
import { buildPhotoIntentInstruction, parsePhotoIntent } from "./photo-intent";

describe("parsePhotoIntent", () => {
  it("解析带人+在家的自拍标记并剥离", () => {
    const reply = "刚做好饭，等你回来。\n\n[[PHOTO|带人=是|在家=是|画面=厨房里端着盘子笑]]";
    const { intent, cleanedText } = parsePhotoIntent(reply);
    expect(intent).toEqual({ includeFace: true, atHome: true, scene: "厨房里端着盘子笑" });
    expect(cleanedText).toBe("刚做好饭，等你回来。");
  });

  it("解析不带人、不在家（吃的/路上）", () => {
    const { intent } = parsePhotoIntent("路上拍到的。[[PHOTO|带人=否|在家=否|画面=下班路上的晚霞]]");
    expect(intent).toEqual({ includeFace: false, atHome: false, scene: "下班路上的晚霞" });
  });

  it("没有标记时原样返回、intent 为 null", () => {
    const { intent, cleanedText } = parsePhotoIntent("就是普通聊天，没想拍照。");
    expect(intent).toBeNull();
    expect(cleanedText).toBe("就是普通聊天，没想拍照。");
  });

  it("鲁棒：全角竖线 / yes-no / 多余空格都能解析", () => {
    const { intent } = parsePhotoIntent("嗯。\n[[ PHOTO ｜ 带人 = yes ｜ 在家 = no ｜ 画面 = 在公园长椅 ]]");
    expect(intent).toEqual({ includeFace: true, atHome: false, scene: "在公园长椅" });
  });

  it("只剥离标记、不动正文里的普通方括号", () => {
    const { cleanedText } = parsePhotoIntent("我在看[书名号]那本书。[[PHOTO|带人=是|在家=是|画面=书房看书]]");
    expect(cleanedText).toBe("我在看[书名号]那本书。");
  });

  it("多个标记时只解析第一个、且只剥离第一个", () => {
    const { intent, cleanedText } = parsePhotoIntent("a[[PHOTO|带人=是|在家=是|画面=一]]b[[PHOTO|带人=否|在家=否|画面=二]]");
    expect(intent?.scene).toBe("一");
    expect(cleanedText).toContain("画面=二"); // 第二个标记未被剥离
  });

  it("画面为空时 scene 为空字符串", () => {
    const { intent } = parsePhotoIntent("嗯。[[PHOTO|带人=是|在家=是|画面=]]");
    expect(intent?.scene).toBe("");
  });
});

describe("buildPhotoIntentInstruction", () => {
  it("是门控段文本、含标记格式、预告口吻与不虚构图片的约束", () => {
    const text = buildPhotoIntentInstruction();
    expect(text).toContain("[[PHOTO|带人=是或否|在家=是或否|画面=简短描述]]");
    expect(text).toContain("预告");
    expect(text).toContain("不要用文字描述或虚构照片");
  });
});
