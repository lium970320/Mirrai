import { describe, expect, it } from "vitest";
import {
  formatRoleplayTranscript,
  parseRoleplayTurnResponse,
  pickNextRoleplayMember,
  shouldSkipAutomaticRoleplayTurnForEconomy,
} from "./roleplay-channel";
import { shouldDeactivateRoleplayChannelAfterMemberRemoval } from "./roleplay-channel-policy";

describe("roleplay channel turn helpers", () => {
  it("picks the next enabled persona after the last speaker", () => {
    const members = [
      { personaId: 1, displayOrder: 0, speakingEnabled: true, analysisStatus: "ready" },
      { personaId: 2, displayOrder: 1, speakingEnabled: true, analysisStatus: "ready" },
    ];
    const picked = pickNextRoleplayMember(members, [
      { personaId: 1, speakerName: "甲", role: "persona", content: "先坐一会儿。" },
    ]);

    expect(picked?.personaId).toBe(2);
  });

  it("honors an explicit persona request when that member can speak", () => {
    const members = [
      { personaId: 1, displayOrder: 0, speakingEnabled: true, analysisStatus: "ready" },
      { personaId: 2, displayOrder: 1, speakingEnabled: true, analysisStatus: "ready" },
    ];

    expect(pickNextRoleplayMember(members, [], 2)?.personaId).toBe(2);
    expect(pickNextRoleplayMember(members, [], 3)).toBeNull();
  });

  it("formats transcript with speaker names without leaking inner thoughts", () => {
    const transcript = formatRoleplayTranscript([
      { personaId: null, speakerName: "用户", role: "user", content: "你们今晚在客厅。" },
      { personaId: 1, speakerName: "甲", role: "persona", content: "我去倒杯水。" },
      { personaId: 2, speakerName: "乙", role: "persona", content: "我把灯调暗一点。" },
    ]);

    expect(transcript).toContain("用户: 你们今晚在客厅。");
    expect(transcript).toContain("甲: 我去倒杯水。");
    expect(transcript).toContain("乙: 我把灯调暗一点。");
  });

  it("parses JSON roleplay output and strips speaker prefixes", () => {
    const parsed = parseRoleplayTurnResponse(
      '{"shouldSpeak":true,"innerThought":"有点想靠近，但先别吓着他。","mood":"playful","reply":"甲：你别站门口，进来坐。"}',
      "甲",
      "warm",
    );

    expect(parsed.shouldSpeak).toBe(true);
    expect(parsed.innerThought).toContain("靠近");
    expect(parsed.mood).toBe("playful");
    expect(parsed.reply).toBe("你别站门口，进来坐。");
  });

  it("parses allowed silence without leaking inner thoughts into a reply", () => {
    const parsed = parseRoleplayTurnResponse(
      '{"shouldSpeak":false,"innerThought":"这会儿先听他们说。","mood":"nostalgic","reply":""}',
      "甲",
      "warm",
    );

    expect(parsed.shouldSpeak).toBe(false);
    expect(parsed.innerThought).toBe("这会儿先听他们说。");
    expect(parsed.mood).toBe("nostalgic");
    expect(parsed.reply).toBe("我在。");
  });

  it("skips only automatic roleplay turns in strict economy mode", () => {
    expect(shouldSkipAutomaticRoleplayTurnForEconomy("strict")).toBe(true);
    expect(shouldSkipAutomaticRoleplayTurnForEconomy("strict", 2)).toBe(false);
    expect(shouldSkipAutomaticRoleplayTurnForEconomy("conservative")).toBe(false);
    expect(shouldSkipAutomaticRoleplayTurnForEconomy("off")).toBe(false);
  });

  it("deactivates roleplay channels that cannot continue after member removal", () => {
    expect(shouldDeactivateRoleplayChannelAfterMemberRemoval(2)).toBe(false);
    expect(shouldDeactivateRoleplayChannelAfterMemberRemoval(1)).toBe(true);
    expect(shouldDeactivateRoleplayChannelAfterMemberRemoval(0)).toBe(true);
  });
});
