import { ENV } from "../_core/env";

/**
 * 拟人回应节奏：忙碌/克制时段"隔一会才回"，而非永远秒回。
 * 这是会改变实时体感的功能，由 PERSONA_REPLY_LATENCY_ENABLED 控制，默认关闭。
 */

// 按作息可用性给的延迟区间（毫秒，有上限）。
const LATENCY_BY_AVAILABILITY: Record<string, [number, number]> = {
  silent_unless_urgent: [0, 0], // 睡眠由既有压制逻辑处理，这里不再叠加
  brief: [4_000, 14_000], // 工作/通勤等忙碌时段：隔几秒到十几秒
  normal: [1_500, 6_000],
  open: [0, 2_500],
};

export function isReplyLatencyEnabled(): boolean {
  return ENV.personaReplyLatencyEnabled;
}

/** 纯函数：按可用性算延迟（不读开关）；未知可用性或区间为 0 返回 0。 */
export function computeReplyLatencyMs(availability: string, random: () => number = Math.random): number {
  const range = LATENCY_BY_AVAILABILITY[availability];
  if (!range) return 0;
  const [min, max] = range;
  if (max <= min) return min;
  return Math.round(min + random() * (max - min));
}
