import { describe, expect, it } from "vitest";
import { extractZhipuAsrTranscript } from "./zhipu-asr";

describe("Zhipu ASR helpers", () => {
  it("extracts transcript from the current GLM-ASR response shape", () => {
    expect(extractZhipuAsrTranscript({
      id: "asr",
      model: "glm-asr-2512",
      text: "我刚刚发的是语音。",
    })).toBe("我刚刚发的是语音。");
  });

  it("extracts transcript from the legacy choice response shape", () => {
    expect(extractZhipuAsrTranscript({
      choices: [
        { message: { content: "你好，这是我的语音输入测试" } },
      ],
    })).toBe("你好，这是我的语音输入测试");
  });

  it("returns empty text when the response has no transcript", () => {
    expect(extractZhipuAsrTranscript({ id: "empty" })).toBe("");
  });
});
