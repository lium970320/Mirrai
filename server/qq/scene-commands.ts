import * as db from "../db";

/**
 * QQ 私聊里的「场景模式」开关命令——让用户不用打开网页就能进入/退出/查看场景。
 * 命令解析做得比较克制（锚定开头），避免误吃正常聊天内容。
 */

export type SceneCommand = { kind: "list" } | { kind: "exit" } | { kind: "enter"; query: string };

export function parseSceneCommand(text: string): SceneCommand | null {
  const t = text.trim().replace(/^\/+/, "").trim();
  if (!t) return null;
  if (/^(退出场景(模式)?|结束场景|离开场景|关闭场景)$/.test(t)) return { kind: "exit" };
  if (/^(场景列表|有哪些场景|场景帮助|当前场景)$/.test(t)) return { kind: "list" };
  const enter = t.match(/^(进入场景|切换场景|开启场景|场景切换|加载场景)[：:\s]*(.*)$/);
  if (enter) {
    const query = enter[2].trim();
    return query ? { kind: "enter", query } : { kind: "list" };
  }
  if (/^场景(模式)?$/.test(t)) return { kind: "list" };
  return null;
}

function formatSceneList(scenes: Array<{ id: number; name: string; icon: string | null }>, activeId: number | null): string {
  const lines = scenes.map((s, i) => `${i + 1}. ${s.icon || "🎭"} ${s.name}${s.id === activeId ? "（当前）" : ""}`);
  return ["可用场景（发「进入场景 名字/编号」切换，「退出场景」取消）：", ...lines].join("\n");
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

  const scenes = (await db.getScenes(binding.userId)) as Array<{ id: number; name: string; icon: string | null }>;
  const persona = await db.getPersonaById(binding.personaId, binding.userId);
  const activeId = (persona as any)?.activeSceneId ?? null;

  if (command.kind === "exit") {
    await db.activateScene(binding.personaId, null);
    return "已退出场景，回到日常。";
  }
  if (command.kind === "list") {
    return scenes.length ? formatSceneList(scenes, activeId) : "目前没有可用场景。";
  }

  const target = findScene(scenes, command.query);
  if (!target) return `没找到场景「${command.query}」。\n${formatSceneList(scenes, activeId)}`;
  await db.activateScene(binding.personaId, target.id);
  return `已进入场景：${target.icon || "🎭"} ${target.name}`;
}
