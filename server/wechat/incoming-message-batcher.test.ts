import { describe, expect, it } from "vitest";
import { buildBatchedWechatInput } from "./incoming-message-batcher";

describe("buildBatchedWechatInput", () => {
  it("keeps a single message as plain text", () => {
    expect(buildBatchedWechatInput(["吃饭了吗"])).toBe("吃饭了吗");
  });

  it("keeps consecutive messages as one continuous utterance", () => {
    expect(buildBatchedWechatInput(["吃饭了吗", "今天好累", "刚下课"])).toBe(
      "吃饭了吗\n今天好累\n刚下课",
    );
  });

  it("keeps a past-time setup connected to follow-up fragments", () => {
    expect(buildBatchedWechatInput(["你还记得中考的时候吗", "你每天都陪着我", "那时候我特别紧张"])).toBe(
      "你还记得中考的时候吗\n你每天都陪着我\n那时候我特别紧张",
    );
  });
});
