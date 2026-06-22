/**
 * 「详细模式」开关——让用户在私聊里切换回复长短。
 * 开启后 replyLength 强制提升到 "long"，关闭后恢复自动推断。
 */

export type VerboseCommand = { kind: "on" } | { kind: "off" } | { kind: "status" };

const ON_PATTERN = /^(详细模式|多说一点|多说点|话多一点|长回复|开启详细|verbose)\s*$/;
const OFF_PATTERN = /^(简洁模式|少说点|话少一点|短回复|关闭详细|关详细|normal)\s*$/;
const STATUS_PATTERN = /^(当前模式|回复模式)\s*$/;

export function parseVerboseCommand(text: string): VerboseCommand | null {
  const t = text.trim().replace(/^\/+/, "").trim();
  if (!t) return null;
  if (ON_PATTERN.test(t)) return { kind: "on" };
  if (OFF_PATTERN.test(t)) return { kind: "off" };
  if (STATUS_PATTERN.test(t)) return { kind: "status" };
  return null;
}

const verboseState = new Map<string, boolean>();

export function setVerboseMode(contactId: string, on: boolean): void {
  if (on) {
    verboseState.set(contactId, true);
  } else {
    verboseState.delete(contactId);
  }
}

export function getVerboseMode(contactId: string): boolean {
  return verboseState.get(contactId) ?? false;
}

export function tryHandleVerboseCommand(contactId: string, text: string): string | null {
  const command = parseVerboseCommand(text);
  if (!command) return null;

  if (command.kind === "on") {
    setVerboseMode(contactId, true);
    return "已开启详细模式，之后会多说一些～";
  }
  if (command.kind === "off") {
    setVerboseMode(contactId, false);
    return "已切回简洁模式。";
  }
  const current = getVerboseMode(contactId);
  return current ? "当前是详细模式（发「简洁模式」关闭）" : "当前是简洁模式（发「详细模式」开启）";
}
