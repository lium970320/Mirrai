import { afterEach, describe, expect, it, vi } from "vitest";
import { clearOperationsEvents, getRecentOperationsEvents } from "../_core/operations-events";
import { sendQqSticker } from "./sticker-sender";

vi.mock("../qq/onebot-client", () => ({
  sendQqImageFile: vi.fn(),
}));

describe("sticker sender diagnostics", () => {
  afterEach(() => {
    clearOperationsEvents();
  });

  it("records an operations event when the selected sticker file is missing", async () => {
    const result = await sendQqSticker("qq:private:1", {
      id: "missing",
      path: "F:/tmp/mirrai-missing-sticker.png",
      type: "png",
      mood: ["开心"],
      intensity: 2,
    });

    expect(result).toEqual({
      ok: false,
      status: "sticker_send_failed",
      reason: "file_not_found",
    });
    expect(getRecentOperationsEvents("stickers")).toEqual([
      expect.objectContaining({
        id: "stickers.file_not_found",
        scope: "stickers",
        title: "表情包文件不存在",
        evidence: "F:/tmp/mirrai-missing-sticker.png",
      }),
    ]);
  });
});
