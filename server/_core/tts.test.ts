import { describe, expect, it } from "vitest";
import { buildLocalVoxcpmSpeechPerformance, humanizeMinimaxSpeechText, humanizeVoxcpmSpeechText } from "./tts";

describe("VoxCPM speech text humanizer", () => {
  it("adds natural pauses and question intonation for short chatty replies", () => {
    expect(humanizeVoxcpmSpeechText("那我陪你聊会，今天累不累。")).toBe("那……我陪你聊会儿。 你今天，累不累？");
  });

  it("keeps already natural short replies stable", () => {
    expect(humanizeVoxcpmSpeechText("别站在风口，晚上容易着凉。")).toBe("别站在风口。 晚上容易着凉。");
  });

  it("adds performance control for voice-only VoxCPM replies", () => {
    const performance = buildLocalVoxcpmSpeechPerformance(
      "那我陪你聊会，今天累不累。",
      "年轻男性，声音温和低沉",
    );

    expect(performance.speechText).toBe("那……我陪你聊会儿。 你今天，累不累？");
    expect(performance.control).toContain("微信语音");
    expect(performance.control).toContain("语气放低一点");
    expect(performance.control).not.toContain("宠溺");
    expect(performance.control).not.toContain("尾音轻轻上扬");
  });
});

describe("MiniMax speech text humanizer", () => {
  it("keeps chatty Chinese replies compact but spoken-friendly", () => {
    expect(humanizeMinimaxSpeechText("嗯  我陪你聊会，今天累不累。")).toBe("嗯，我陪你聊会儿，你今天，累不累？");
  });

  it("preserves sentence pauses for MiniMax to render naturally", () => {
    expect(humanizeMinimaxSpeechText("好，别站在风口。晚上容易着凉。")).toBe("好。 别站在风口。 晚上容易着凉。");
  });
});
