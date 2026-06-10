import type { PersonaTurnPlatform } from "./persona-turn-planner";

export type SocialRuntimePlatform = PersonaTurnPlatform;
export type SocialRuntimeChannel = "web" | "wechat" | "qq";

export type SocialRuntimeBinding = {
  personaId: number;
  userId: number;
};

export type SocialRuntimeOutputPreference = {
  allowText?: boolean;
  allowVoice?: boolean;
  allowStickers?: boolean;
  allowProactive?: boolean;
};

const PLATFORM_OUTPUT_PREFERENCES: Record<SocialRuntimePlatform, Required<SocialRuntimeOutputPreference>> = {
  web: {
    allowText: true,
    allowVoice: false,
    allowStickers: false,
    allowProactive: false,
  },
  wechat: {
    allowText: true,
    allowVoice: false,
    allowStickers: false,
    allowProactive: true,
  },
  qq: {
    allowText: true,
    allowVoice: true,
    allowStickers: true,
    allowProactive: true,
  },
};

export type SocialRuntimeRequestBase = {
  platform: SocialRuntimePlatform;
  channel?: SocialRuntimeChannel;
  binding: SocialRuntimeBinding;
  contactName: string;
  sceneOverlay?: string | null;
  outputPreference?: SocialRuntimeOutputPreference;
};

export function defaultChannelForPlatform(platform: SocialRuntimePlatform): SocialRuntimeChannel {
  if (platform === "wechat") return "wechat";
  if (platform === "qq") return "qq";
  return "web";
}

export function resolveRuntimeChannel(input: {
  platform: SocialRuntimePlatform;
  channel?: SocialRuntimeChannel | null;
}): SocialRuntimeChannel {
  return input.channel ?? defaultChannelForPlatform(input.platform);
}

export function defaultOutputPreferenceForPlatform(platform: SocialRuntimePlatform): SocialRuntimeOutputPreference {
  return { ...PLATFORM_OUTPUT_PREFERENCES[platform] };
}

export function resolveRuntimeOutputPreference(input: {
  platform: SocialRuntimePlatform;
  outputPreference?: SocialRuntimeOutputPreference | null;
}): SocialRuntimeOutputPreference {
  return {
    ...PLATFORM_OUTPUT_PREFERENCES[input.platform],
    ...(input.outputPreference ?? {}),
  };
}
