import { describe, expect, it } from "vitest";
import { stripLeadingAsides } from "./reply-utils";

describe("stripLeadingAsides", () => {
  it("removes leading full-width parenthetical narration", () => {
    expect(stripLeadingAsides("（她轻轻笑了一下）今天怎么这么晚呀？")).toBe(
      "今天怎么这么晚呀？"
    );
  });

  it("removes multiple leading asides", () => {
    expect(stripLeadingAsides("（靠近）（压低声音）我在呢。")).toBe("我在呢。");
  });

  it("keeps normal mid-sentence parentheses", () => {
    expect(stripLeadingAsides("我今天有点开心（真的）。")).toBe("我今天有点开心（真的）。");
  });
});
