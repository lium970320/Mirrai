import fs from "fs";

export type WeChatSyncCircuitBreakerReason =
  | "wechat4u_login_http_400"
  | "wechat4u_sync_retcode_1102"
  | "wechat4u_consecutive_sync_failure"
  | "wechat4u_sync_stalled";

export function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return [error.name, error.message, error.stack].filter(Boolean).join("\n");
  }
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function isWechat4uPuppet(puppetName: string): boolean {
  return puppetName.toLowerCase().includes("wechat4u");
}

export function getWechatSyncCircuitBreakerReason(error: unknown): WeChatSyncCircuitBreakerReason | null {
  const message = normalizeErrorMessage(error);
  const compact = message.replace(/\s+/g, " ");

  if (/AssertionError/i.test(compact) && /(?:^|\D)400\s*!=\s*400(?:\D|$)/.test(compact)) {
    return "wechat4u_login_http_400";
  }

  if (
    /(?:^|\D)1102(?:\D|$)/.test(compact) &&
    /(AssertionError|retcode|synccheck|syncCheck|sync|wechat4u|==\s*0)/i.test(compact)
  ) {
    return "wechat4u_sync_retcode_1102";
  }

  if (/连续\s*\d+\s*次同步失败/.test(compact)) {
    return "wechat4u_consecutive_sync_failure";
  }

  if (/状态同步超过\s*\d+(?:\.\d+)?s未响应/.test(compact)) {
    return "wechat4u_sync_stalled";
  }

  return null;
}

export function getWechatSyncCircuitBreakerMessage(reason: WeChatSyncCircuitBreakerReason): string {
  switch (reason) {
    case "wechat4u_login_http_400":
      return "微信 Web 登录入口返回 400，当前账号或环境可能无法获取扫码登录会话，已停止自动重试。";
    case "wechat4u_sync_retcode_1102":
      return "微信 Web 同步返回 1102，通常表示微信侧拒绝/失效了当前 Web 会话，已停止自动重试。";
    case "wechat4u_consecutive_sync_failure":
      return "微信 Web 同步连续失败，已停止自动重试，避免反复重登触发更高风控。";
    case "wechat4u_sync_stalled":
      return "微信 Web 同步长时间无响应，已停止自动重试，避免反复重启。";
  }
}

export function isUsableMemoryCardContent(raw: string): boolean {
  const content = raw.trim();
  if (!content || content === "{}") return false;

  try {
    const parsed = JSON.parse(content) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.keys(parsed).length > 0;
    }
  } catch {
    return content.length > 2;
  }

  return true;
}

export function hasUsableMemoryCard(memoryFilePath: string): boolean {
  if (!fs.existsSync(memoryFilePath)) return false;
  try {
    return isUsableMemoryCardContent(fs.readFileSync(memoryFilePath, "utf8"));
  } catch {
    return false;
  }
}
