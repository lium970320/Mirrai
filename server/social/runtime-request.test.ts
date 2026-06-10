import { describe, expect, it } from "vitest";
import {
  defaultChannelForPlatform,
  defaultOutputPreferenceForPlatform,
  resolveRuntimeChannel,
  resolveRuntimeOutputPreference,
} from "./runtime-request";

describe("social runtime request helpers", () => {
  it("maps platform defaults to their canonical message channels", () => {
    expect(defaultChannelForPlatform("web")).toBe("web");
    expect(defaultChannelForPlatform("wechat")).toBe("wechat");
    expect(defaultChannelForPlatform("qq")).toBe("qq");
  });

  it("keeps an explicit channel override when a caller needs one", () => {
    expect(resolveRuntimeChannel({ platform: "qq", channel: "qq" })).toBe("qq");
    expect(resolveRuntimeChannel({ platform: "web", channel: "web" })).toBe("web");
    expect(resolveRuntimeChannel({ platform: "wechat" })).toBe("wechat");
  });

  it("defines platform output capability defaults for the shared runtime", () => {
    expect(defaultOutputPreferenceForPlatform("web")).toEqual({
      allowText: true,
      allowVoice: false,
      allowStickers: false,
      allowProactive: false,
    });
    expect(defaultOutputPreferenceForPlatform("wechat")).toEqual({
      allowText: true,
      allowVoice: false,
      allowStickers: false,
      allowProactive: true,
    });
    expect(defaultOutputPreferenceForPlatform("qq")).toEqual({
      allowText: true,
      allowVoice: true,
      allowStickers: true,
      allowProactive: true,
    });
  });

  it("lets a caller override a platform output capability for a specific request", () => {
    expect(resolveRuntimeOutputPreference({
      platform: "qq",
      outputPreference: { allowVoice: false },
    })).toEqual({
      allowText: true,
      allowVoice: false,
      allowStickers: true,
      allowProactive: true,
    });
  });
});
