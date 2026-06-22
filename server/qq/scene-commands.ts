import * as db from "../db";

/**
 * QQ 私聊「场景模式」开关命令——一个开关进出沉浸状态。
 *
 * 进入场景模式后：允许用【】写旁白（动作 / 神态 / 环境，与说出口的话分开）并大幅放开篇幅；
 * 退出后回到日常：不写旁白、回复简短自然。
 *
 * 两种进入方式效果相同，都会打开场景模式：
 *   - 纯沉浸（无固定背景）：发「场景模式 / 进入场景」
 *   - 带背景设定：发「进入场景 名字」，额外加载该预设场景的设定文本（需先在网页建好）
 * 退出：发「退出场景」。不建任何预设场景也能用纯沉浸。
 *
 * 「是否处于场景模式」由内存开关 getSceneMode 标记（按 contactId，进程重启清空），
 * 作为「旁白放行 + 篇幅放开」的统一信号贯穿生成与发送各层；
 * activeSceneId 只额外决定有没有背景设定文本，不再单独控制沉浸。
 */

export type SceneCommand =
  | { kind: "list" }
  | { kind: "exit" }
  | { kind: "status" }
  | { kind: "enter"; query?: string };

export function parseSceneCommand(text: string): SceneCommand | null {
  const t = text.trim().replace(/^\/+/, "").trim();
  if (!t) return null;

  if (/^(退出场景(模式)?|结束场景|离开场景|关闭场景|退出情景|退出沉浸|关闭沉浸|关闭旁白|日常模式|daily)$/i.test(t)) {
    return { kind: "exit" };
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

export function setSceneMode(contactId: string, on: boolean): void {
  sceneModeState.set(contactId, on);
}

export function getSceneMode(contactId: string): boolean {
  return sceneModeState.get(contactId) === true;
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
    await db.activateScene(binding.personaId, null);
    return "已退出场景，回到日常：不写旁白，回复简短自然。";
  }

  const scenes = (await db.getScenes(binding.userId)) as Array<{ id: number; name: string; icon: string | null }>;
  const persona = await db.getPersonaById(binding.personaId, binding.userId);
  const activeId = (persona as any)?.activeSceneId ?? null;

  if (command.kind === "list") {
    return scenes.length
      ? formatSceneList(scenes, activeId)
      : "目前没有预设背景。直接发「场景模式」就能进入沉浸（旁白 + 放开篇幅）；想加固定背景，再去网页建场景。";
  }

  if (command.kind === "status") {
    const on = getSceneMode(contactId) || activeId != null;
    if (!on) return "当前是日常模式：不写旁白、回复简短。发「场景模式」进入沉浸。";
    const bg = activeId != null ? scenes.find(s => s.id === activeId)?.name ?? null : null;
    return bg
      ? `当前在场景模式：背景「${bg}」，旁白 + 放开篇幅已开。发「退出场景」回日常。`
      : "当前在场景模式：旁白 + 放开篇幅已开（未指定背景）。发「退出场景」回日常。";
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
  return "场景模式已开启。我会用【】写动作、神态、场景旁白，和说出口的话分开；篇幅也放开。想加固定背景就发「进入场景 名字」，退出发「退出场景」。";
}
