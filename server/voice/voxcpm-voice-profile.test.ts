import { describe, expect, it } from "vitest";
import {
  inferVoxcpmVoiceProfileId,
  selectVoxcpmVoiceProfile,
  type VoxcpmVoiceProfile,
} from "./voxcpm-voice-profile";

const profiles: VoxcpmVoiceProfile[] = [
  {
    id: "calm",
    label: "日常",
    referenceAudioPath: "calm.wav",
    promptText: "calm prompt",
    control: "calm control",
    moods: ["日常"],
    priority: 1,
  },
  {
    id: "comfort",
    label: "安慰",
    referenceAudioPath: "",
    promptText: "",
    control: "comfort control",
    moods: ["安慰"],
    priority: 3,
  },
  {
    id: "tease",
    label: "调侃",
    referenceAudioPath: "tease.wav",
    promptText: "tease prompt",
    control: "tease control",
    moods: ["调侃"],
    priority: 2,
  },
  {
    id: "angry_soft",
    label: "轻微不满",
    referenceAudioPath: "angry.wav",
    promptText: "angry prompt",
    control: "angry control",
    moods: ["不满"],
    priority: 4,
  },
  {
    id: "sad_low",
    label: "低落深夜",
    referenceAudioPath: "",
    promptText: "",
    control: "sad control",
    moods: ["低落"],
    priority: 3,
  },
];

describe("VoxCPM voice profile selection", () => {
  it("infers profiles from reply content", () => {
    expect(inferVoxcpmVoiceProfileId("别怕，我陪你。")).toBe("comfort");
    expect(inferVoxcpmVoiceProfileId("你还挺嘴硬，哈哈。")).toBe("tease");
    expect(inferVoxcpmVoiceProfileId("不许再这样了。")).toBe("angry_soft");
    expect(inferVoxcpmVoiceProfileId("这么晚还没睡。")).toBe("sad_low");
    expect(inferVoxcpmVoiceProfileId("我刚到所里。")).toBe("calm");
  });

  it("keeps the selected emotional control while reusing the calm reference when profile audio is missing", () => {
    const selected = selectVoxcpmVoiceProfile({
      text: "今天累了就早点躺下，我陪你一会。",
      profiles,
      fileExists: filePath => filePath === "calm.wav",
    });

    expect(selected.requestedProfileId).toBe("comfort");
    expect(selected.profile.id).toBe("comfort");
    expect(selected.profile.referenceAudioPath).toBe("calm.wav");
    expect(selected.profile.promptText).toBe("calm prompt");
    expect(selected.profile.control).toBe("comfort control");
    expect(selected.fallbackReferenceProfileId).toBe("calm");
    expect(selected.fallbackReason).toBe("empty_reference_path");
  });

  it("uses a profile-specific reference when available", () => {
    const selected = selectVoxcpmVoiceProfile({
      text: "你还挺会逗我笑。",
      profiles,
      fileExists: filePath => filePath === "tease.wav",
    });

    expect(selected.requestedProfileId).toBe("tease");
    expect(selected.profile.id).toBe("tease");
    expect(selected.profile.referenceAudioPath).toBe("tease.wav");
    expect(selected.fallbackReferenceProfileId).toBeUndefined();
  });
});
