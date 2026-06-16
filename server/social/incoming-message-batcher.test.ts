import { describe, expect, it, vi } from "vitest";
import { buildBatchedSocialInput, enqueueSocialTextMessage, type BatchedTextMessage } from "./incoming-message-batcher";

describe("buildBatchedSocialInput", () => {
  it("keeps a single message as plain text", () => {
    expect(buildBatchedSocialInput(["吃饭了吗"])).toBe("吃饭了吗");
  });

  it("keeps consecutive messages as one continuous utterance", () => {
    expect(buildBatchedSocialInput(["吃饭了吗", "今天好累", "刚下课"])).toBe(
      "吃饭了吗\n今天好累\n刚下课",
    );
  });

  it("keeps a past-time setup connected to follow-up fragments", () => {
    expect(buildBatchedSocialInput(["你还记得中考的时候吗", "你每天都陪着我", "那时候我特别紧张"])).toBe(
      "你还记得中考的时候吗\n你每天都陪着我\n那时候我特别紧张",
    );
  });

  it("marks the active batch stale when a newer message arrives during processing", async () => {
    vi.useFakeTimers();
    const batches: BatchedTextMessage[] = [];
    const contactId = "test-stale-batch";
    const contact = { say: vi.fn() };

    const onBatch = vi.fn(async (batch: BatchedTextMessage) => {
      batches.push(batch);
      expect(batch.isStale()).toBe(false);
      if (batches.length === 1) {
        enqueueSocialTextMessage({
          contact,
          contactId,
          contactName: "敏子",
          text: "第二句",
          onBatch,
        });
        expect(batch.isStale()).toBe(true);
      }
    });

    enqueueSocialTextMessage({
      contact,
      contactId,
      contactName: "敏子",
      text: "第一句",
      onBatch,
    });

    await vi.advanceTimersByTimeAsync(4_300);
    expect(onBatch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(4_300);
    expect(onBatch).toHaveBeenCalledTimes(2);
    expect(batches[1]?.messages).toEqual(["第二句"]);

    vi.useRealTimers();
  });
});
