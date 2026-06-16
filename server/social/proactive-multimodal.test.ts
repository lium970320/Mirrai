import { describe, expect, it } from "vitest";
import { decideProactiveModality } from "./proactive-multimodal";

describe("proactive modality decision (pure)", () => {
  it("picks voice for low rolls, sticker for mid, text for high", () => {
    expect(decideProactiveModality(() => 0.05)).toBe("voice");
    expect(decideProactiveModality(() => 0.18)).toBe("sticker");
    expect(decideProactiveModality(() => 0.9)).toBe("text");
  });

  it("keeps text overwhelmingly likely", () => {
    let text = 0;
    for (let i = 0; i < 100; i += 1) {
      // 均匀采样 0..1
      if (decideProactiveModality(() => i / 100) === "text") text += 1;
    }
    expect(text).toBeGreaterThanOrEqual(70);
  });
});
