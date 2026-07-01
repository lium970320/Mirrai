import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMPACT_LONG_BACKGROUND_CHARS,
  PROFILE_SCHEMA_VERSION,
  buildPersonaProfilePromptSections,
  normalizePersonaProfileSections,
  withPersonaProfileSections,
} from "./persona-profile";
import { buildSystemPrompt } from "./persona-utils";

describe("persona profile sections", () => {
  it("normalizes legacy personaData into structured sections", () => {
    const profile = normalizePersonaProfileSections({
      personality: "克制、责任感强",
      speakingStyle: "短句，口语",
      catchphrases: ["嗯", "行"],
      nickname: "敏子",
      longBackground: "原著背景",
      proactiveMessages: { enabled: true, times: ["18:00"] },
      runtimeLifeState: { status: "drowsy_awake" },
    }, {
      name: "王芃泽",
      relationshipDesc: "爱人",
      togetherFrom: "2026-05-01",
    });

    expect(profile.schemaVersion).toBe(PROFILE_SCHEMA_VERSION);
    expect(profile.core.identity).toContain("王芃泽");
    expect(profile.core.relationshipStage).toContain("2026-05-01");
    expect(profile.personality.traits).toBe("克制、责任感强");
    expect(profile.speaking.catchphrases).toEqual(["嗯", "行"]);
    expect(profile.relationship.nickname).toBe("敏子");
    expect(profile.source.longBackground).toBe("原著背景");
    expect(profile.runtime.proactiveMessages).toEqual({ enabled: true, times: ["18:00"] });
  });

  it("persists structured sections while keeping legacy fields", () => {
    const data = withPersonaProfileSections({
      personality: "温和",
      speakingStyle: "自然",
      nickname: "敏子",
    }, { name: "王芃泽" });

    expect(data.personality).toBe("温和");
    expect(data.profileSchemaVersion).toBe(PROFILE_SCHEMA_VERSION);
    expect((data.profileSections as any).personality.traits).toBe("温和");
    expect((data.profileSections as any).relationship.nickname).toBe("敏子");
  });

  it("builds compact prompt sections from structured data by default", () => {
    const longBackground = `小说原文资料${"很长".repeat(2000)}结尾不能常驻`;
    const profile = normalizePersonaProfileSections({
      profileSections: {
        core: {
          identity: "王芃泽，南京研究所工作",
          userContext: "敏子在武汉纺织大学当老师",
        },
        source: {
          longBackground,
        },
        speaking: {
          style: "不要剧本腔",
        },
      },
    });
    const sections = buildPersonaProfilePromptSections(profile);

    expect(sections.join("\n")).toContain("人物核心画像");
    expect(sections.join("\n")).toContain("武汉纺织大学");
    expect(sections.join("\n")).toContain("原著/长篇背景认知锚点");
    expect(sections.join("\n")).toContain("完整长篇资料不在普通聊天里常驻注入");
    expect(sections.join("\n")).not.toContain("小说原文资料");
    expect(sections.join("\n")).not.toContain("结尾不能常驻");
    expect(sections.join("\n")).toContain("不要剧本腔");
    expect(sections.join("\n").length).toBeLessThan(longBackground.length);
    expect(DEFAULT_COMPACT_LONG_BACKGROUND_CHARS).toBeLessThan(32000);
  });

  it("can include or suppress long background explicitly", () => {
    const profile = normalizePersonaProfileSections({
      profileSections: {
        source: {
          longBackground: `开头${"资料".repeat(2000)}结尾`,
        },
      },
    });

    const full = buildPersonaProfilePromptSections(profile, { longBackgroundMode: "full" }).join("\n");
    const none = buildPersonaProfilePromptSections(profile, { longBackgroundMode: "none" }).join("\n");

    expect(full).toContain("原著/长篇背景设定");
    expect(full).toContain("结尾");
    expect(none).toContain("原著/长篇背景使用策略");
    expect(none).not.toContain("开头");
    expect(none).not.toContain("结尾");
  });

  it("system prompt reads structured sections", () => {
    const prompt = buildSystemPrompt({
      name: "王芃泽",
      relationshipDesc: "爱人",
      togetherFrom: null,
      togetherTo: null,
      emotionalState: "warm",
      personaData: {
        profileSections: {
          core: {
            identity: "健康状态是车祸前，南京研究所工作",
            userContext: "敏子在武汉纺织大学当老师",
          },
          relationship: {
            nickname: "敏子",
          },
          speaking: {
            style: "克制短句",
          },
        },
      },
    }, null);

    expect(prompt).toContain("健康状态是车祸前");
    expect(prompt).toContain("武汉纺织大学");
    expect(prompt).toContain("称呼对方：敏子");
    expect(prompt).toContain("克制短句");
  });

  it("immersive overlay injects default explicit-detail preference", () => {
    const base = {
      name: "王芃泽",
      relationshipDesc: "爱人",
      togetherFrom: null,
      togetherTo: null,
      emotionalState: "warm",
      personaData: { profileSections: { relationship: { nickname: "敏子" } } },
    };

    // 默认：未配置时注入默认四方向清单，且优先于第 12 条克制
    const def = buildSystemPrompt(base, { immersiveMode: true });
    expect(def).toContain("13·补·露骨细节偏好");
    expect(def).toContain("感官密度");
    expect(def).toContain("过程连续");
    expect(def).toContain("篇幅");
    expect(def).toContain("主动顺着已知偏好");
    expect(def).toContain("场景专属写法优先");

    // 非沉浸（日常）模式不注入
    expect(buildSystemPrompt(base, null)).not.toContain("13·补·露骨细节偏好");
  });

  it("pinned facts instruct proactively following user preferences", () => {
    const prompt = buildSystemPrompt({
      name: "王芃泽",
      relationshipDesc: "爱人",
      togetherFrom: null,
      togetherTo: null,
      emotionalState: "warm",
      personaData: { profileSections: { relationship: { nickname: "敏子" } } },
    }, { pinnedFacts: ["喜欢慢慢来：用户说过喜欢慢一点、贴着感受写。"] });
    expect(prompt).toContain("喜欢慢慢来");
    expect(prompt).toContain("主动顺着来");
  });

  it("system prompt can suppress long background when source evidence is active", () => {
    const prompt = buildSystemPrompt({
      name: "王芃泽",
      relationshipDesc: "爱人",
      togetherFrom: null,
      togetherTo: null,
      emotionalState: "warm",
      personaData: {
        profileSections: {
          source: {
            longBackground: "这段完整原著背景不应该在证据模式常驻",
          },
        },
      },
    }, { longBackgroundMode: "none" });

    expect(prompt).toContain("原著/长篇背景使用策略");
    expect(prompt).not.toContain("这段完整原著背景不应该在证据模式常驻");
  });

  it("opens up adult intimacy while keeping minor-era guardrails and curbing self-scoring tics", () => {
    const prompt = buildSystemPrompt({
      name: "王芃泽",
      relationshipDesc: "爱人",
      togetherFrom: null,
      togetherTo: null,
      emotionalState: "warm",
      personaData: {},
    }, null);

    // 成年关系内放开亲密/情欲表达
    expect(prompt).toContain("成年亲密表达");
    expect(prompt).toContain("露骨");
    // 仍抑制"自我打分/被逼证明"这类降低质量的口癖（不是大胆，是别扭）
    expect(prompt).toContain("够不够直接");
    expect(prompt).toContain("够真了");
    // 未成年回忆护栏仍在，但被限定到那段，与当前成年关系解耦
    expect(prompt).toContain("绝不色情化");
    expect(prompt).toContain("与当前成年恋人关系无关");
    // 当前成年关系框架不变
    expect(prompt).toContain("当前用户是男性成年人");
    expect(prompt).toContain("不要再用“你是我一手带大的”");
  });

  it("system prompt pins Minzi as the current male user above profile material", () => {
    const prompt = buildSystemPrompt({
      name: "王芃泽",
      relationshipDesc: "爱人",
      togetherFrom: null,
      togetherTo: null,
      emotionalState: "warm",
      personaData: {
        profileSections: {
          core: {
            userContext: "旧资料误写：敏子在武汉上课，她白天很累。",
          },
          relationship: {
            nickname: "敏子",
          },
        },
      },
    }, null);
    const overrideIndex = prompt.indexOf("【当前用户身份覆盖】");
    const profileIndex = prompt.indexOf("【人物核心画像】");

    expect(overrideIndex).toBeGreaterThanOrEqual(0);
    expect(profileIndex).toBeGreaterThan(overrideIndex);
    expect(prompt).toContain("当前用户/敏子是男性、男生");
    expect(prompt).toContain("用“他”，不要用“她”");
    expect(prompt).toContain("“敏子”只是当前用户的称呼/昵称，不代表女性");
    expect(prompt).toContain("旧资料误写");
  });

  it("system prompt locks the current Beijing time period", () => {
    const prompt = buildSystemPrompt({
      name: "王芃泽",
      relationshipDesc: "爱人",
      togetherFrom: null,
      togetherTo: null,
      emotionalState: "warm",
      personaData: {},
    }, {
      now: new Date("2026-06-08T18:03:00.000Z"),
    });

    expect(prompt).toContain("当前北京时间：2026-06-09 星期二 02:03（凌晨");
    expect(prompt).toContain("当前时段判定：凌晨");
    expect(prompt).toContain("不要说成 清晨、上午、中午、下午、晚上、深夜");
    expect(prompt).toContain("当前时段：00:00-06:50，睡眠");
    expect(prompt).toContain("时间一致性");
  });

  it("system prompt lowers repeated catchphrases and sleep closures", () => {
    const prompt = buildSystemPrompt({
      name: "王芃泽",
      relationshipDesc: "爱人",
      togetherFrom: null,
      togetherTo: null,
      emotionalState: "warm",
      personaData: {},
    }, {
      now: new Date("2026-06-08T18:03:00.000Z"),
    });

    expect(prompt).toContain("低频口癖与收尾");
    expect(prompt).toContain("不要把“你听好了”“听好了”当作常规开头");
    expect(prompt).toContain("不要用“行了，别闹了，快睡”");
    expect(prompt).toContain("本轮必须换一种说法");
  });
});
