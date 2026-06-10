import { describe, expect, it } from "vitest";
import {
  USER_ACCOUNT_DELETE_SECTIONS,
  USER_DATA_EXPORT_SECTIONS,
  buildUserDataExportPayload,
} from "./db";

describe("user data export payload", () => {
  it("includes Plan2 private data sections and omits local secrets", () => {
    const payload = buildUserDataExportPayload({
      user: {
        username: "codex",
        name: "Codex",
        passwordHash: "salt:hash",
      },
      personas: [{ id: 1 }],
      messages: [{ id: 2 }],
      personaFiles: [{ id: 3, fileUrl: "/uploads/a.txt" }],
      personaSources: [{ id: 4 }],
      personaSourceChunks: [{ id: 5 }],
      memories: [{ id: 6 }],
      emotionSnapshots: [{ id: 7 }],
      diaryEntries: [{ id: 8 }],
      roleplayChannels: [{ id: 9 }],
      roleplayChannelMembers: [{ id: 10 }],
      roleplayMessages: [{ id: 11 }],
      wechatBindings: [{ id: 12 }],
      skillJobs: [{ id: 13 }],
      llmUsageRecords: [{ id: 14 }],
      personaRuntimeStates: [{ id: 15 }],
      llmConfigs: [{ id: 16, providerName: "DeepSeek", apiKey: "secret-key" }],
      wechatBotState: [{ id: 17 }],
      scenes: [{ id: 18 }],
    });

    for (const section of USER_DATA_EXPORT_SECTIONS) {
      expect(Array.isArray(payload[section])).toBe(true);
      expect(payload[section].length).toBeGreaterThan(0);
    }

    expect(payload.user).toMatchObject({ username: "codex", name: "Codex" });
    expect(payload.user).not.toHaveProperty("passwordHash");
    expect(payload.llmConfigs[0]).toMatchObject({ providerName: "DeepSeek" });
    expect(payload.llmConfigs[0]).not.toHaveProperty("apiKey");
    expect(JSON.stringify(payload)).not.toContain("salt:hash");
    expect(JSON.stringify(payload)).not.toContain("secret-key");
    expect(JSON.stringify(payload)).not.toContain("passwordHash");
    expect(JSON.stringify(payload)).not.toContain("apiKey");
  });

  it("keeps account deletion coverage aligned with exported private sections", () => {
    const deleteSections = new Set<string>(USER_ACCOUNT_DELETE_SECTIONS);
    const requiredDeleteSections = USER_DATA_EXPORT_SECTIONS.filter(
      section => section !== "wechatBotState" && section !== "scenes",
    );

    for (const section of requiredDeleteSections) {
      expect(deleteSections.has(section)).toBe(true);
    }

    expect(deleteSections.has("wechatBotState")).toBe(true);
    expect(deleteSections.has("scenes")).toBe(true);
    expect(deleteSections.has("users")).toBe(true);
  });

  it("defaults missing collections to arrays", () => {
    const payload = buildUserDataExportPayload({ user: { username: "empty" } });

    for (const section of USER_DATA_EXPORT_SECTIONS) {
      expect(payload[section]).toEqual([]);
    }
  });
});
