import { ENV } from "../_core/env";
import { pathToFileURL } from "url";

export type QqContactKind = "private" | "group";

export type ParsedQqContactId = {
  kind: QqContactKind;
  id: string;
};

export type QqRecordFileInfo = {
  file?: string;
  file_id?: string;
  url?: string;
  file_size?: string | number;
  file_name?: string;
  base64?: string;
};

export type QqFriendHistoryMessage = {
  message_id?: number | string;
  time?: number;
  message_type?: string;
  sub_type?: string;
  self_id?: number | string;
  user_id?: number | string;
  sender?: {
    user_id?: number | string;
    nickname?: string;
    card?: string;
  };
  message?: string | Array<{ type: string; data?: Record<string, unknown> }>;
  raw_message?: string;
};

type OneBotResponse<T = unknown> = {
  status?: string;
  retcode?: number;
  data?: T;
  message?: string;
  wording?: string;
};

let lastError: string | null = null;
const QQ_TEXT_SEND_MAX_ATTEMPTS = 2;
const QQ_TEXT_SEND_RETRY_DELAY_MS = 800;

function baseUrl(): string {
  return ENV.qqOnebotBaseUrl.replace(/\/+$/, "");
}

function onebotHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (ENV.qqOnebotAccessToken) {
    headers.authorization = `Bearer ${ENV.qqOnebotAccessToken}`;
  }
  return headers;
}

function toOnebotId(id: string): number | string {
  const parsed = Number(id);
  return Number.isSafeInteger(parsed) ? parsed : id;
}

function isTransientOnebotSendError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /timeout|timed out|fetch failed|econnreset|econnrefused|socket|network|aborted/i.test(message);
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendTextAction(target: ParsedQqContactId, text: string): Promise<void> {
  if (target.kind === "private") {
    await onebotAction("send_private_msg", {
      user_id: toOnebotId(target.id),
      message: text,
    });
    return;
  }
  await onebotAction("send_group_msg", {
    group_id: toOnebotId(target.id),
    message: text,
  });
}

export function parseQqContactId(contactId: string): ParsedQqContactId | null {
  const match = /^qq:(private|group):(.+)$/.exec(contactId.trim());
  if (!match) return null;
  return { kind: match[1] as QqContactKind, id: match[2] };
}

async function onebotAction<T = unknown>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(`${baseUrl()}/${action}`, {
    method: "POST",
    headers: onebotHeaders(),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`OneBot HTTP ${response.status}`);
  }

  const body = await response.json() as OneBotResponse<T>;
  if (body.status && body.status !== "ok") {
    throw new Error(body.wording || body.message || `OneBot action ${action} failed`);
  }
  if (typeof body.retcode === "number" && body.retcode !== 0) {
    throw new Error(body.wording || body.message || `OneBot retcode ${body.retcode}`);
  }

  return body.data as T;
}

export async function sendQqText(contactId: string, text: string): Promise<boolean> {
  const parsed = parseQqContactId(contactId);
  if (!parsed) {
    console.warn("[QQ] Invalid contact id:", contactId);
    return false;
  }

  for (let attempt = 1; attempt <= QQ_TEXT_SEND_MAX_ATTEMPTS; attempt += 1) {
    try {
      await sendTextAction(parsed, text);
      const retry = attempt > 1 ? " retry=1" : "";
      console.info(`[QQ] Sent text contact=${contactId} chars=${Array.from(text).length}${retry}`);
      lastError = null;
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const shouldRetry = attempt < QQ_TEXT_SEND_MAX_ATTEMPTS && isTransientOnebotSendError(err);
      if (shouldRetry) {
        console.warn(`[QQ] Transient text send failure contact=${contactId}; retrying once:`, message);
        await wait(QQ_TEXT_SEND_RETRY_DELAY_MS);
        continue;
      }
      lastError = message;
      console.warn(`[QQ] Failed to send text contact=${contactId}:`, lastError);
      return false;
    }
  }

  return false;
}

export async function sendQqRecordFile(contactId: string, filePath: string): Promise<boolean> {
  const parsed = parseQqContactId(contactId);
  if (!parsed) {
    console.warn("[QQ] Invalid contact id:", contactId);
    return false;
  }
  const target = parsed;

  async function send(file: string): Promise<void> {
    const payload = {
      message: [{ type: "record", data: { file } }],
      ...(target.kind === "private"
        ? { user_id: toOnebotId(target.id) }
        : { group_id: toOnebotId(target.id) }),
    };
    await onebotAction(target.kind === "private" ? "send_private_msg" : "send_group_msg", payload);
  }

  try {
    await send(filePath);
    console.info(`[QQ] Sent record contact=${contactId}`);
    lastError = null;
    return true;
  } catch (firstErr) {
    try {
      await send(pathToFileURL(filePath).toString());
      console.info(`[QQ] Sent record contact=${contactId} route=file_url`);
      lastError = null;
      return true;
    } catch (secondErr) {
      lastError = secondErr instanceof Error ? secondErr.message : String(secondErr);
      console.warn(
        `[QQ] Failed to send record contact=${contactId}:`,
        firstErr instanceof Error ? firstErr.message : String(firstErr),
        lastError,
      );
      return false;
    }
  }
}

export async function sendQqImageFile(contactId: string, filePath: string): Promise<boolean> {
  const parsed = parseQqContactId(contactId);
  if (!parsed) {
    console.warn("[QQ] Invalid contact id:", contactId);
    return false;
  }
  const target = parsed;

  async function send(file: string): Promise<void> {
    const payload = {
      message: [{ type: "image", data: { file } }],
      ...(target.kind === "private"
        ? { user_id: toOnebotId(target.id) }
        : { group_id: toOnebotId(target.id) }),
    };
    await onebotAction(target.kind === "private" ? "send_private_msg" : "send_group_msg", payload);
  }

  try {
    await send(filePath);
    console.info(`[QQ] Sent image contact=${contactId}`);
    lastError = null;
    return true;
  } catch (firstErr) {
    try {
      await send(pathToFileURL(filePath).toString());
      console.info(`[QQ] Sent image contact=${contactId} route=file_url`);
      lastError = null;
      return true;
    } catch (secondErr) {
      lastError = secondErr instanceof Error ? secondErr.message : String(secondErr);
      console.warn(
        `[QQ] Failed to send image contact=${contactId}:`,
        firstErr instanceof Error ? firstErr.message : String(firstErr),
        lastError,
      );
      return false;
    }
  }
}

export async function getQqRecordFile(
  options: { file?: string; fileId?: string; outFormat?: string },
): Promise<QqRecordFileInfo | null> {
  const file = options.file?.trim();
  const fileId = options.fileId?.trim();
  if (!file && !fileId) return null;

  try {
    const data = await onebotAction<QqRecordFileInfo>("get_record", {
      ...(file ? { file } : {}),
      ...(fileId ? { file_id: fileId } : {}),
      out_format: options.outFormat ?? "mp3",
    });
    lastError = null;
    return data ?? null;
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    console.warn("[QQ] Failed to get record file:", lastError);
    return null;
  }
}

export async function getQqLoginInfo(): Promise<{ user_id?: number | string; nickname?: string } | null> {
  try {
    const loginInfo = await onebotAction<{ user_id?: number | string; nickname?: string }>("get_login_info");
    lastError = null;
    return loginInfo ?? null;
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    console.warn("[QQ] Failed to get login info:", lastError);
    return null;
  }
}

export async function getQqFriendList(): Promise<Array<{ user_id?: number | string; nickname?: string; remark?: string }> | null> {
  try {
    const friends = await onebotAction<Array<{ user_id?: number | string; nickname?: string; remark?: string }>>("get_friend_list");
    lastError = null;
    return Array.isArray(friends) ? friends : [];
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    console.warn("[QQ] Failed to get friend list:", lastError);
    return null;
  }
}

export async function getQqFriendMessageHistory(
  userId: string | number,
  count = 20,
): Promise<QqFriendHistoryMessage[] | null> {
  try {
    const data = await onebotAction<{ messages?: QqFriendHistoryMessage[] } | QqFriendHistoryMessage[]>(
      "get_friend_msg_history",
      {
        user_id: toOnebotId(String(userId)),
        count,
      },
    );
    const messages = Array.isArray(data) ? data : Array.isArray(data?.messages) ? data.messages : [];
    lastError = null;
    return messages;
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    console.warn(`[QQ] Failed to get friend history user=${userId}:`, lastError);
    return null;
  }
}

export async function getQqBotStatus() {
  if (!ENV.qqEnabled) {
    return {
      enabled: false,
      status: "disabled" as const,
      baseUrl: ENV.qqOnebotBaseUrl,
      allowGroups: ENV.qqAllowGroups,
      webhookSecretConfigured: Boolean(ENV.qqOnebotWebhookSecret),
      lastError: null,
    };
  }

  try {
    const status = await onebotAction<{ online?: boolean; good?: boolean }>("get_status");
    if (status?.online !== true || status?.good === false) {
      throw new Error(`OneBot reports offline (online=${status?.online ?? "unknown"}, good=${status?.good ?? "unknown"})`);
    }
    const loginInfo = await onebotAction<{ user_id?: number | string; nickname?: string }>("get_login_info");
    const friends = await getQqFriendList();
    if (friends === null) {
      throw new Error(`OneBot friend list check failed (${lastError ?? "unknown error"})`);
    }
    if (friends && friends.length === 0) {
      throw new Error("OneBot reports online but friend list is empty");
    }
    lastError = null;
    return {
      enabled: true,
      status: "connected" as const,
      baseUrl: ENV.qqOnebotBaseUrl,
      allowGroups: ENV.qqAllowGroups,
      webhookSecretConfigured: Boolean(ENV.qqOnebotWebhookSecret),
      loggedInUser: loginInfo?.nickname ?? String(loginInfo?.user_id ?? ""),
      selfId: loginInfo?.user_id ? String(loginInfo.user_id) : "",
      lastError: null,
    };
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    return {
      enabled: true,
      status: "error" as const,
      baseUrl: ENV.qqOnebotBaseUrl,
      allowGroups: ENV.qqAllowGroups,
      webhookSecretConfigured: Boolean(ENV.qqOnebotWebhookSecret),
      lastError,
    };
  }
}
