import { describe, expect, it } from "vitest";
import {
  DEFAULT_PARTNER_NAME,
  DEFAULT_SETTING_LINE,
  DEFAULT_SOURCE_TERMS,
  getPersonaLifeConfig,
} from "./persona-life-config";

describe("persona life config", () => {
  it("returns current defaults when no config present (behavior-preserving)", () => {
    const cfg = getPersonaLifeConfig({});
    expect(cfg.settingLine).toBe(DEFAULT_SETTING_LINE);
    expect(cfg.partnerName).toBe(DEFAULT_PARTNER_NAME);
    expect(cfg.sourceTerms).toEqual(DEFAULT_SOURCE_TERMS);
    expect(cfg.userPronoun).toBe("他");
    expect(cfg.routines).toBeUndefined();
  });

  it("reads overrides from profileSections.life", () => {
    const cfg = getPersonaLifeConfig({
      profileSections: {
        life: {
          settingLine: "默认设定：林深常驻上海。",
          partnerName: "阿澈",
          sourceTerms: ["林深", "阿澈"],
          userPronoun: "她",
        },
      },
    });
    expect(cfg.settingLine).toContain("林深");
    expect(cfg.partnerName).toBe("阿澈");
    expect(cfg.sourceTerms).toEqual(["林深", "阿澈"]);
    expect(cfg.userPronoun).toBe("她");
  });

  it("only accepts routines when all three day kinds are provided", () => {
    const slot = [{ start: "00:00", end: "24:00", label: "x", stateId: "sleeping", category: "sleep", status: "asleep", availability: "open", description: "", behavior: "", transitionHint: "" }];
    const partial = getPersonaLifeConfig({ profileSections: { life: { routines: { weekday: slot } } } });
    expect(partial.routines).toBeUndefined();
    const full = getPersonaLifeConfig({ profileSections: { life: { routines: { weekday: slot, saturday: slot, sunday: slot } } } });
    expect(full.routines?.weekday).toHaveLength(1);
  });

  it("ignores malformed user pronoun and falls back to male default", () => {
    expect(getPersonaLifeConfig({ profileSections: { life: { userPronoun: "它" } } }).userPronoun).toBe("他");
  });
});
