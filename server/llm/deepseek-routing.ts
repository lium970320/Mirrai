import type { LLMPurpose } from "./types";

export const DEEPSEEK_FLASH_PROVIDER = "DeepSeek-Flash";
export const DEEPSEEK_PRO_PROVIDER = "DeepSeek-Pro";

const DYNAMIC_DEEPSEEK_ALIASES = new Set([
  "deepseek",
  "deepseek-auto",
]);

const PRO_PURPOSES = new Set<LLMPurpose>([
  "source_recall",
  "roleplay",
  "reflection",
  "persona_analysis",
  "skill_pipeline",
  "graduation",
]);

function normalizeProviderName(value: string | undefined | null): string {
  return value?.trim().toLowerCase() ?? "";
}

export function isDynamicDeepSeekProvider(value: string | undefined | null): boolean {
  return DYNAMIC_DEEPSEEK_ALIASES.has(normalizeProviderName(value));
}

export function deepSeekProviderForPurpose(purpose: LLMPurpose | undefined): string {
  return purpose && PRO_PURPOSES.has(purpose)
    ? DEEPSEEK_PRO_PROVIDER
    : DEEPSEEK_FLASH_PROVIDER;
}

export function resolveDeepSeekProvider(
  requestedProvider: string | undefined,
  purpose: LLMPurpose | undefined,
  defaultProvider: string,
): string | undefined {
  const requested = requestedProvider?.trim();
  if (requested) {
    return isDynamicDeepSeekProvider(requested)
      ? deepSeekProviderForPurpose(purpose)
      : requested;
  }

  return isDynamicDeepSeekProvider(defaultProvider)
    ? deepSeekProviderForPurpose(purpose)
    : undefined;
}
