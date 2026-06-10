import {
  buildTurnPlanInstruction,
  planPersonaTurn,
  type PersonaTurnPlan,
  type PersonaTurnPlatform,
} from "./persona-turn-planner";
import {
  defaultOutputPreferenceForPlatform,
  type SocialRuntimeChannel,
  type SocialRuntimeOutputPreference,
} from "./runtime-request";
import type { ProactiveDeliveryResult } from "./proactive-delivery";

export type ProactiveRuntimeTarget = {
  channel: SocialRuntimeChannel;
  platform: PersonaTurnPlatform | null;
};

export type ProactiveRuntimePlan = {
  platform: PersonaTurnPlatform;
  channel: SocialRuntimeChannel;
  outputPreference: SocialRuntimeOutputPreference;
  turnPlan: PersonaTurnPlan;
  instruction: string;
};

export type ProactiveRuntimeDiagnostics = {
  lastTurnAt: string;
  platform: PersonaTurnPlatform;
  channel: SocialRuntimeChannel;
  mode: "proactive";
  trigger: "scheduled" | "ambient";
  inputPreview: string;
  replyPreview: string;
  outputPreference: SocialRuntimeOutputPreference;
  turnPlan: PersonaTurnPlan;
  delivery?: Pick<ProactiveDeliveryResult, "sent" | "channel" | "platform" | "reason">;
} & Record<string, unknown>;

export function buildProactiveRuntimePlan(input: {
  target: ProactiveRuntimeTarget;
  inputText: string;
  recentMessages?: Array<{ role: string; content: string }>;
  personaData?: unknown;
  now?: Date;
}): ProactiveRuntimePlan {
  const platform = input.target.platform ?? "web";
  const outputPreference = defaultOutputPreferenceForPlatform(platform);
  const turnPlan = planPersonaTurn({
    platform,
    mode: "proactive",
    inputText: input.inputText,
    recentMessages: input.recentMessages,
    personaData: input.personaData,
    now: input.now,
    outputPreference,
  });

  return {
    platform,
    channel: input.target.channel,
    outputPreference,
    turnPlan,
    instruction: buildTurnPlanInstruction(turnPlan),
  };
}

export function buildProactiveRuntimeDiagnostics(input: {
  runtimePlan: ProactiveRuntimePlan;
  trigger: ProactiveRuntimeDiagnostics["trigger"];
  inputText: string;
  replyText: string;
  delivery?: ProactiveDeliveryResult;
  now?: Date;
  details?: Record<string, unknown>;
}): ProactiveRuntimeDiagnostics {
  return {
    lastTurnAt: (input.now ?? new Date()).toISOString(),
    platform: input.runtimePlan.platform,
    channel: input.runtimePlan.channel,
    mode: "proactive",
    trigger: input.trigger,
    inputPreview: input.inputText.slice(0, 240),
    replyPreview: input.replyText.slice(0, 240),
    outputPreference: input.runtimePlan.outputPreference,
    turnPlan: input.runtimePlan.turnPlan,
    delivery: input.delivery
      ? {
        sent: input.delivery.sent,
        channel: input.delivery.channel,
        platform: input.delivery.platform,
        reason: input.delivery.reason,
      }
      : undefined,
    ...(input.details ?? {}),
  };
}
