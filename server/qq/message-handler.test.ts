import { describe, expect, it } from "vitest";
import { buildQqContactKey, extractQqImageSegments, extractQqPlainText } from "./message-handler";

describe("QQ OneBot message handling helpers", () => {
  it("builds private and group contact keys", () => {
    expect(buildQqContactKey({ message_type: "private", user_id: 12345 })).toBe("qq:private:12345");
    expect(buildQqContactKey({ message_type: "group", group_id: "67890" })).toBe("qq:group:67890");
  });

  it("extracts text from array message segments", () => {
    expect(extractQqPlainText([
      { type: "text", data: { text: "中考的时候" } },
      { type: "image", data: { file: "a.jpg" } },
      { type: "face", data: { id: "14" } },
    ])).toBe("中考的时候 [图片] [表情]");
  });

  it("normalizes CQ-code string messages", () => {
    expect(extractQqPlainText("看这个[CQ:image,file=a.jpg]哈哈[CQ:face,id=14]"))
      .toBe("看这个 [图片] 哈哈 [表情]");
  });

  it("extracts QQ image segments from array and CQ-code messages", () => {
    expect(extractQqImageSegments([
      { type: "text", data: { text: "看" } },
      { type: "image", data: { file: "a.jpg", url: "https://example.test/a.jpg" } },
    ])).toHaveLength(1);
    expect(extractQqImageSegments("看这个[CQ:image,file=a.jpg,url=https://example.test/a.jpg]"))
      .toEqual([{ type: "image", data: { file: "a.jpg", url: "https://example.test/a.jpg" } }]);
  });
});
