import { parseSelfieCommand } from "../qq/selfie-commands";

/**
 * 决定本轮要不要让人物发照片，以及发哪种（取代旧的「正则命中→固定 ACK→立即触发」）。
 * 纯规则、可单测、不调 LLM、不改回复 prompt：
 *  - 明确要拍环境（拍家里/看看你那/你家什么样）→ 必发，kind=environment
 *  - 明确要自拍（发自拍/拍照/拍张照）→ 必发，kind=selfie
 *  - 问「你在哪/在干嘛/现在怎样」→ 概率触发自拍（默认 40%）
 *  - 空闲时段（availability=open）→ 低概率自主自拍（默认 8%）
 *  - 睡眠等时段不主动；冷却内（距上次 < 3h 或当日已 ≥2 张）不做概率/自主触发
 */

export type PhotoKind = "selfie" | "environment";

export type SelfieReason = "explicit_request" | "location_query" | "spontaneous" | "none";

export type SelfieDecision = {
  shouldSend: boolean;
  kind: PhotoKind;
  situation: string;
  reason: SelfieReason;
};

const LOCATION_QUERY_RE =
  /(你在哪|你在干嘛|你在干什么|你在做什么|在忙什么|这会儿在干|现在在干|现在在哪|你现在在|你那边怎样|你现在怎样|你那边什么样)/;

export function isLocationQuery(text: string): boolean {
  return LOCATION_QUERY_RE.test((text ?? "").replace(/\s+/g, ""));
}

// 拍环境/场景：拍家里、看看你那、拍窗外/外面、拍做的饭等；以及「你家/你那边 什么样」。
const ENV_REQUEST_RE =
  /(?:拍一?下|拍一?张|拍|来一?张|发一?张|给我看看?|看看?)(?:你的?)?(?:.{0,3})(家里?|屋里|你那边?|窗外|外面|做的饭|做的菜|你这边)/;
const ENV_QUERY_RE = /你(家|那边?)(什么样|长什么样|怎样|啥样)/;

export function parseEnvironmentRequest(text: string): { situation: string } | null {
  const t = (text ?? "").replace(/\s+/g, "");
  if (!t) return null;
  return ENV_REQUEST_RE.test(t) || ENV_QUERY_RE.test(t) ? { situation: t } : null;
}

export type SelfieCooldown = { lastAt?: string | null; countToday?: number };

// 冷却：当日已发 ≥ maxPerDay，或距上次 < cooldownHours，则不允许概率/自主触发（明确指令不受此限）。
export function isSelfieCooldownActive(
  cooldown: SelfieCooldown,
  now: Date,
  cooldownHours = 3,
  maxPerDay = 2,
): boolean {
  const countToday = cooldown.countToday ?? 0;
  if (countToday >= maxPerDay) return true;
  if (!cooldown.lastAt) return false;
  const last = new Date(cooldown.lastAt).getTime();
  if (!Number.isFinite(last)) return false;
  return now.getTime() - last < cooldownHours * 3_600_000;
}

export type SelfieDecisionInput = {
  inputText: string;
  availability: string; // turnPlan.availability：silent_unless_urgent | brief | normal | open
  cooldown: SelfieCooldown;
  now?: Date;
  random?: () => number;
  locationQueryProbability?: number; // 默认 0.4（适中）
  spontaneousProbability?: number; // 默认 0.08（适中）
};

function none(): SelfieDecision {
  return { shouldSend: false, kind: "selfie", situation: "", reason: "none" };
}

export function decideSelfieOpportunity(input: SelfieDecisionInput): SelfieDecision {
  const now = input.now ?? new Date();
  const random = input.random ?? Math.random;
  const text = input.inputText ?? "";

  // 1) 明确要拍环境/场景：必发（不受冷却限制）
  const env = parseEnvironmentRequest(text);
  if (env) {
    return { shouldSend: true, kind: "environment", situation: env.situation, reason: "explicit_request" };
  }

  // 2) 明确要自拍：必发（不受冷却限制）
  const command = parseSelfieCommand(text);
  if (command) {
    return { shouldSend: true, kind: "selfie", situation: command.situation, reason: "explicit_request" };
  }

  // 睡眠等"非急事静默"时段：不做概率/自主触发
  if (input.availability === "silent_unless_urgent") return none();

  // 冷却内：不做概率/自主触发
  if (isSelfieCooldownActive(input.cooldown, now)) return none();

  // 3) 问"你在哪/在干嘛/现在怎样"：概率触发自拍（默认 40%）
  if (isLocationQuery(text)) {
    const p = input.locationQueryProbability ?? 0.4;
    return random() < p
      ? { shouldSend: true, kind: "selfie", situation: "", reason: "location_query" }
      : none();
  }

  // 4) 空闲时段（open）自主低概率自拍（默认 8%）
  if (input.availability === "open") {
    const p = input.spontaneousProbability ?? 0.08;
    return random() < p
      ? { shouldSend: true, kind: "selfie", situation: "", reason: "spontaneous" }
      : none();
  }

  return none();
}
