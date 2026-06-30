import * as db from "../db";

/**
 * QQ 私聊「场景模式」开关命令——一个开关进出沉浸状态，外加「双人模式」子开关。
 *
 * 进入场景模式后：允许用【】写旁白（动作 / 神态 / 环境，与说出口的话分开）并大幅放开篇幅；
 * 退出后回到日常：不写旁白、回复简短自然。
 *
 * 双人模式（依存于场景模式）：开启后旁白可同时描写人物自己和对方两人的动作/神态/场景，
 * 用户输入只作「剧情引导」而非对方的真实台词；关闭后回到「只演自己一方」的单人场景。
 * 开双人会自动开场景；退出场景会一并关掉双人。
 *
 * 状态都在内存 Map（按 contactId，进程重启清空）；activeSceneId 只额外决定背景设定文本。
 */

export type SceneCommand =
  | { kind: "list" }
  | { kind: "exit" }
  | { kind: "status" }
  | { kind: "enter"; query?: string }
  | { kind: "dual-on" }
  | { kind: "dual-off" };

export function parseSceneCommand(text: string): SceneCommand | null {
  const t = text.trim().replace(/^\/+/, "").trim();
  if (!t) return null;

  if (/^(退出场景(模式)?|结束场景|离开场景|关闭场景|退出情景|退出沉浸|关闭沉浸|关闭旁白|日常模式|daily)$/i.test(t)) {
    return { kind: "exit" };
  }
  if (/^(退出双人|关闭双人|取消双人|单人模式|单人场景|单人)$/.test(t)) {
    return { kind: "dual-off" };
  }
  if (/^(双人模式|双人场景|双人沉浸|开启双人|双人)$/.test(t)) {
    return { kind: "dual-on" };
  }
  if (/^(场景列表|有哪些场景|场景帮助)$/.test(t)) {
    return { kind: "list" };
  }
  if (/^(场景|场景状态|当前场景|情景状态|沉浸状态)$/.test(t)) {
    return { kind: "status" };
  }
  // 「进入场景 X」带背景；「进入场景」「切换场景」等不带参时即纯沉浸进入
  const enter = t.match(/^(进入场景|切换场景|加载场景|场景切换)[：:\s]*(.*)$/);
  if (enter) {
    const query = enter[2].trim();
    return query ? { kind: "enter", query } : { kind: "enter" };
  }
  if (/^(场景模式|开启场景|沉浸模式|情景模式|情景沉浸|开启沉浸|开启旁白|旁白模式|immersive)$/i.test(t)) {
    return { kind: "enter" };
  }
  return null;
}

const sceneModeState = new Map<string, boolean>();
const dualModeState = new Map<string, boolean>();
// 沉浸会话开始时间（epoch ms，按 contactId）：作息自动退出时用它区分「过夜遗留（开得早、该清）」
// 和「用户当天上班时段内主动重开（不该被自动清）」。
const sceneOpenedAt = new Map<string, number>();
// 某 contact「今天已因上班自动退出过」的北京日期键：保证一天只自动退一次，且不打扰白天手动重开。
const lastAutoExitDate = new Map<string, string>();

export function setSceneMode(contactId: string, on: boolean): void {
  sceneModeState.set(contactId, on);
  if (on) {
    if (!sceneOpenedAt.has(contactId)) sceneOpenedAt.set(contactId, Date.now());
  } else {
    sceneOpenedAt.delete(contactId);
  }
}

export function getSceneMode(contactId: string): boolean {
  return sceneModeState.get(contactId) === true;
}

export function setDualMode(contactId: string, on: boolean): void {
  dualModeState.set(contactId, on);
}

export function getDualMode(contactId: string): boolean {
  return dualModeState.get(contactId) === true;
}

/** 当前内存里处于场景或双人模式的所有 contactId（供作息自动退出遍历）。 */
export function getActiveSceneContactIds(): string[] {
  const ids = new Set<string>();
  sceneModeState.forEach((on, id) => { if (on) ids.add(id); });
  dualModeState.forEach((on, id) => { if (on) ids.add(id); });
  const out: string[] = [];
  ids.forEach(id => out.push(id));
  return out;
}

/** 该 contact 沉浸会话的开始时间（epoch ms）；未开返回 undefined。 */
export function getSceneOpenedAt(contactId: string): number | undefined {
  return sceneOpenedAt.get(contactId);
}

export function getLastAutoExitDate(contactId: string): string | undefined {
  return lastAutoExitDate.get(contactId);
}

export function setLastAutoExitDate(contactId: string, dateKey: string): void {
  lastAutoExitDate.set(contactId, dateKey);
}

function formatSceneList(scenes: Array<{ id: number; name: string; icon: string | null }>, activeId: number | null): string {
  const lines = scenes.map((s, i) => `${i + 1}. ${s.icon || "🎭"} ${s.name}${s.id === activeId ? "（当前）" : ""}`);
  return ["可用背景（发「进入场景 名字/编号」加载，「退出场景」回日常）：", ...lines].join("\n");
}

function findScene<T extends { id: number; name: string }>(scenes: T[], query: string): T | undefined {
  const exact = scenes.find(s => s.name === query);
  if (exact) return exact;
  const idx = Number(query);
  if (Number.isInteger(idx) && idx >= 1 && idx <= scenes.length) return scenes[idx - 1];
  return scenes.find(s => s.name.includes(query) || query.includes(s.name));
}

/**
 * 若文本是场景命令则执行并返回要回给用户的提示文本；不是命令返回 null（交给正常聊天）。
 */
export async function tryHandleSceneCommand(contactId: string, text: string): Promise<string | null> {
  const command = parseSceneCommand(text);
  if (!command) return null;

  const binding = await db.getQqBindingByContactId(contactId);
  if (!binding) return "还没绑定分身，没法切换场景。";

  if (command.kind === "exit") {
    setSceneMode(contactId, false);
    setDualMode(contactId, false);
    await db.activateScene(binding.personaId, null);
    return "已退出场景，回到日常：不写旁白，回复简短自然。";
  }

  if (command.kind === "dual-on") {
    setSceneMode(contactId, true);
    setDualMode(contactId, true);
    return "双人模式已开启（已自动进入场景模式）。我会用【】同时写你和我两个人的动作、神态、反应；你发的话只当剧情引导，我据此推进整段双人情景。想加固定背景发「进入场景 名字」，回到只演我自己发「退出双人」，整个退出发「退出场景」。";
  }

  if (command.kind === "dual-off") {
    setDualMode(contactId, false);
    return getSceneMode(contactId)
      ? "已关闭双人模式，回到单人场景：只演我自己一方、不替你写台词，旁白照旧。整个退出发「退出场景」。"
      : "当前不在双人模式。发「双人模式」开启双人；发「场景模式」进入单人沉浸。";
  }

  const scenes = (await db.getScenes(binding.userId)) as Array<{ id: number; name: string; icon: string | null }>;
  const persona = await db.getPersonaById(binding.personaId, binding.userId);
  const activeId = (persona as any)?.activeSceneId ?? null;
  const myName = (persona as any)?.name ?? "我";

  if (command.kind === "list") {
    return scenes.length
      ? formatSceneList(scenes, activeId)
      : "目前没有预设背景。直接发「场景模式」就能进入沉浸（旁白 + 放开篇幅）；想加固定背景，再去网页建场景。";
  }

  if (command.kind === "status") {
    const sceneOn = getSceneMode(contactId) || activeId != null;
    const dualOn = getDualMode(contactId);
    if (!sceneOn) return "当前是日常模式：不写旁白、回复简短。发「场景模式」进入单人沉浸，发「双人模式」进入双人沉浸。";
    const mode = dualOn ? `双人场景（旁白写你和${myName}双方）` : `单人场景（只演${myName}自己）`;
    const bg = activeId != null ? scenes.find(s => s.id === activeId)?.name ?? null : null;
    return bg
      ? `当前在${mode}：背景「${bg}」，旁白 + 放开篇幅已开。发「退出场景」回日常。`
      : `当前在${mode}：旁白 + 放开篇幅已开（未指定背景）。发「退出场景」回日常。`;
  }

  // kind === "enter"
  if (command.query) {
    const target = findScene(scenes, command.query);
    if (!target) return `没找到背景「${command.query}」。\n${formatSceneList(scenes, activeId)}`;
    setSceneMode(contactId, true);
    await db.activateScene(binding.personaId, target.id);
    return `已进入场景：${target.icon || "🎭"} ${target.name}。我会用【】写旁白、放开篇幅；发「退出场景」回日常。`;
  }

  setSceneMode(contactId, true);
  return "场景模式已开启。我会用【】写动作、神态、场景旁白，和说出口的话分开；篇幅也放开。想加固定背景发「进入场景 名字」，想让旁白写双方发「双人模式」，退出发「退出场景」。";
}

// ───────────────────────── 作息驱动的自动退出 ─────────────────────────

/** 工作日「白天该上班 / 在单位」的作息状态：覆盖出门通勤到下午下班（约 07:40–17:30）。 */
export const WORKDAY_DAYTIME_STATES = new Set<string>([
  "commuting_to_work",
  "working_morning",
  "lunch_break",
  "midday_rest",
  "working_afternoon",
]);

/**
 * 自动退出场景 + 双人，回到日常（清内存双开关 + DB 背景场景）。供作息守门调用。
 */
export async function autoExitSceneAndDualMode(contactId: string, personaId: number): Promise<void> {
  setSceneMode(contactId, false); // 同时清掉 sceneOpenedAt
  setDualMode(contactId, false);
  await db.activateScene(personaId, null);
}

/**
 * 纯判定：工作日到上班点时，当前是否应自动退出沉浸场景。
 * 规则：仅工作日；仅白天上班时段；只清「过夜 / 上班点之前就开着」的场景（当天上班后手动重开的不动）；
 * 每天每 contact 只退一次。
 */
export function shouldAutoExitForWork(params: {
  dayKind: string;
  stateId: string;
  sceneOn: boolean;
  openedAtMs: number | undefined;
  workStartMs: number;
  lastExitDateKey: string | undefined;
  todayDateKey: string;
}): boolean {
  if (params.dayKind !== "weekday") return false;
  if (!WORKDAY_DAYTIME_STATES.has(params.stateId)) return false;
  if (!params.sceneOn) return false;
  if (params.lastExitDateKey === params.todayDateKey) return false;
  // 当天上班点之后才开的（用户白天主动玩）不自动退；过夜 / 上班前开的 / 无记录的才退。
  if (params.openedAtMs !== undefined && params.openedAtMs >= params.workStartMs) return false;
  return true;
}
