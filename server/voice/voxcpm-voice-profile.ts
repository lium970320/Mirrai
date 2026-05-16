import { existsSync } from "fs";
import { ENV } from "../_core/env";

export type VoxcpmVoiceProfileId = "calm" | "comfort" | "tease" | "angry_soft" | "sad_low";

export type VoxcpmVoiceProfile = {
  id: VoxcpmVoiceProfileId;
  label: string;
  referenceAudioPath: string;
  promptText: string;
  control: string;
  moods: string[];
  priority: number;
};

export type SelectedVoxcpmVoiceProfile = {
  profile: VoxcpmVoiceProfile;
  requestedProfileId: VoxcpmVoiceProfileId;
  fallbackReferenceProfileId?: VoxcpmVoiceProfileId;
  fallbackReason?: string;
};

export type VoxcpmVoiceProfileSelectionInput = {
  text: string;
  defaultProfileId?: VoxcpmVoiceProfileId;
  fileExists?: (filePath: string) => boolean;
  profiles?: VoxcpmVoiceProfile[];
};

const PROFILE_IDS: VoxcpmVoiceProfileId[] = ["calm", "comfort", "tease", "angry_soft", "sad_low"];

function firstNonEmpty(...values: Array<string | undefined>): string {
  return values.find(value => value?.trim())?.trim() ?? "";
}

function envForProfile(profileId: VoxcpmVoiceProfileId, suffix: string): string {
  const key = `VOXCPM_PROFILE_${profileId.toUpperCase()}_${suffix}`;
  return process.env[key]?.trim() ?? "";
}

function defaultControlFor(profileId: VoxcpmVoiceProfileId): string {
  const base = ENV.voxcpmControl;
  switch (profileId) {
    case "comfort":
      return `${base}；低声温柔，带安慰和靠近一点的陪伴感；语速稍慢，句间停顿更明显，不要哭腔`;
    case "tease":
      return `${base}；语气轻松，带一点很轻的笑意和调侃感；不要油腻，不要夸张`;
    case "angry_soft":
      return `${base}；轻微不满但压着声音，不吼叫，不爆发；像熟人之间低声提醒`;
    case "sad_low":
      return `${base}；声音偏低，情绪收住，短句之间留停顿；适合深夜、想念、低落，不要演得很悲伤`;
    case "calm":
    default:
      return base;
  }
}

function labelFor(profileId: VoxcpmVoiceProfileId): string {
  switch (profileId) {
    case "comfort": return "安慰";
    case "tease": return "调侃";
    case "angry_soft": return "轻微不满";
    case "sad_low": return "低落深夜";
    case "calm":
    default:
      return "日常";
  }
}

function moodsFor(profileId: VoxcpmVoiceProfileId): string[] {
  switch (profileId) {
    case "comfort": return ["安慰", "心疼", "疲惫", "难过", "陪伴"];
    case "tease": return ["调侃", "玩笑", "轻松", "撒娇"];
    case "angry_soft": return ["轻度生气", "不满", "吃醋", "提醒"];
    case "sad_low": return ["低落", "深夜", "想念", "安静"];
    case "calm":
    default:
      return ["日常", "平静", "普通回复"];
  }
}

function priorityFor(profileId: VoxcpmVoiceProfileId): number {
  switch (profileId) {
    case "angry_soft": return 4;
    case "comfort": return 3;
    case "sad_low": return 3;
    case "tease": return 2;
    case "calm":
    default:
      return 1;
  }
}

export function buildVoxcpmVoiceProfiles(): VoxcpmVoiceProfile[] {
  return PROFILE_IDS.map(profileId => ({
    id: profileId,
    label: labelFor(profileId),
    referenceAudioPath: firstNonEmpty(
      envForProfile(profileId, "REFERENCE_AUDIO_PATH"),
      profileId === "calm" ? ENV.voxcpmReferenceAudioPath : "",
    ),
    promptText: firstNonEmpty(
      envForProfile(profileId, "PROMPT_TEXT"),
      profileId === "calm" ? ENV.voxcpmPromptText : "",
    ),
    control: firstNonEmpty(envForProfile(profileId, "CONTROL")) || defaultControlFor(profileId),
    moods: moodsFor(profileId),
    priority: priorityFor(profileId),
  }));
}

function normalizeProfileId(value: string | undefined): VoxcpmVoiceProfileId {
  const normalized = value?.trim().toLowerCase().replace(/-/g, "_");
  if (normalized && (PROFILE_IDS as string[]).includes(normalized)) {
    return normalized as VoxcpmVoiceProfileId;
  }
  return "calm";
}

export function inferVoxcpmVoiceProfileId(text: string): VoxcpmVoiceProfileId {
  const compact = text.replace(/\s+/g, "");
  if (/生气|气你|不许|再这样|别再|硬撑|听见没有|怎么还这样|欠收拾|不准|烦你|别闹了/.test(compact)) {
    return "angry_soft";
  }
  if (/累|难受|委屈|想哭|哭|不舒服|心疼|别怕|陪你|睡不着|抱抱|没事/.test(compact)) {
    return "comfort";
  }
  if (/凌晨|深夜|晚安|想你|舍不得|安静|窗外|睡了吗|还没睡/.test(compact)) {
    return "sad_low";
  }
  if (/哈哈|笑|逗|笨|傻|坏|嘴硬|不肯认输|理直气壮|拆穿|调侃|哼|贫|开玩笑|有点意思/.test(compact)) {
    return "tease";
  }
  return "calm";
}

function cloneWithFallbackReference(
  profile: VoxcpmVoiceProfile,
  fallbackProfile: VoxcpmVoiceProfile,
): VoxcpmVoiceProfile {
  return {
    ...profile,
    referenceAudioPath: profile.referenceAudioPath || fallbackProfile.referenceAudioPath,
    promptText: profile.promptText || fallbackProfile.promptText,
  };
}

export function selectVoxcpmVoiceProfile(
  input: VoxcpmVoiceProfileSelectionInput,
): SelectedVoxcpmVoiceProfile {
  const profiles = input.profiles ?? buildVoxcpmVoiceProfiles();
  const defaultProfileId = input.defaultProfileId ?? normalizeProfileId(process.env.VOXCPM_VOICE_PROFILE_DEFAULT);
  const fileExists = input.fileExists ?? existsSync;
  const defaultProfile = profiles.find(profile => profile.id === defaultProfileId)
    ?? profiles.find(profile => profile.id === "calm")
    ?? buildVoxcpmVoiceProfiles()[0];
  const requestedProfileId = inferVoxcpmVoiceProfileId(input.text);
  const requestedProfile = profiles.find(profile => profile.id === requestedProfileId) ?? defaultProfile;

  const requestedReferenceExists = Boolean(
    requestedProfile.referenceAudioPath && fileExists(requestedProfile.referenceAudioPath),
  );
  if (requestedReferenceExists) {
    return { profile: requestedProfile, requestedProfileId };
  }

  const defaultReferenceExists = Boolean(
    defaultProfile.referenceAudioPath && fileExists(defaultProfile.referenceAudioPath),
  );
  if (defaultReferenceExists) {
    return {
      profile: cloneWithFallbackReference(requestedProfile, defaultProfile),
      requestedProfileId,
      fallbackReferenceProfileId: defaultProfile.id,
      fallbackReason: requestedProfile.referenceAudioPath ? "missing_reference_file" : "empty_reference_path",
    };
  }

  return {
    profile: requestedProfile,
    requestedProfileId,
    fallbackReason: "no_available_reference",
  };
}
