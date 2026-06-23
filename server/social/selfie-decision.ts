import { parseSelfieCommand } from "../qq/selfie-commands";

/**
 * 只判断「明确指令」要不要拍 + 拍哪种（必发、破冷却）。纯规则、可单测、不调 LLM：
 *  - 明确要拍环境（拍家里/看看你那/你家什么样）→ 必发，kind=environment
 *  - 明确要自拍（发自拍/拍照/拍张照）→ 必发，kind=selfie
 *  - 其余一律不发：「自然该不该拍」已交给 LLM 在回复里输出 [[PHOTO]] 标记（见 photo-intent.ts）。
 *    旧的「问在哪→概率自拍」「空闲→自主自拍」等规则概率触发已随 LLM 通用拍照整体移除。
 */

export type PhotoKind = "selfie" | "environment";

// 决策只产出这两态；message-handler 给 generateAndSendPhoto 传的 "spontaneous" 是另写的字面量、与此无关。
export type SelfieReason = "explicit_request" | "none";

export type SelfieDecision = {
  shouldSend: boolean;
  kind: PhotoKind;
  situation: string;
  reason: SelfieReason;
  /** 合拍：想要两人合照（仅自拍指令里出现「合拍/合照/一起拍」时为 true） */
  withPartner?: boolean;
};

// 拍环境/场景：拍家里、看看你那、拍做的饭等；以及「你家/你那边 什么样」。
// 「家里/卧室/客厅…」这类强场景词允许宽前缀（看看/想看看也算）；
// 「外面/窗外」太泛，只接「拍/发」紧邻，避免把「看外面下雨没/想看看外面」当成要环境照（那会破冷却必发）。
const ENV_REQUEST_RE =
  /(?:拍|来|发|给我看看?|看看?|想看看?)[一个张下]{0,2}(?:你的?)?[^。！？!?\n]{0,4}(家里?|屋里?|你那边?|你这边?|房间|卧室|客厅|阳台|厨房|书房|做的饭|做的菜)|(?:拍|发)[一个张下]{0,2}(?:你的?)?(?:窗外|外面)/;
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
  now: Date = new Date(),
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
};

function none(): SelfieDecision {
  return { shouldSend: false, kind: "selfie", situation: "", reason: "none" };
}

/**
 * 只判断「明确指令」要不要拍 + 拍哪种（必发、破冷却）。
 * 「自然地该不该拍」已交给 LLM 输出 [[PHOTO]] 标记（见 social/photo-intent），不再用规则概率/自主触发。
 */
export function decideSelfieOpportunity(input: SelfieDecisionInput): SelfieDecision {
  const text = input.inputText ?? "";

  // 明确要拍环境/场景（拍家里、看看你那、拍做的饭…）：必发
  const env = parseEnvironmentRequest(text);
  if (env) {
    return { shouldSend: true, kind: "environment", situation: env.situation, reason: "explicit_request" };
  }

  // 明确要自拍（发自拍/拍张照…）：必发
  const command = parseSelfieCommand(text);
  if (command) {
    return { shouldSend: true, kind: "selfie", situation: command.situation, reason: "explicit_request", withPartner: command.withPartner };
  }

  return none();
}
