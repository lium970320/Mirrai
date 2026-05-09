import { ENV } from "../_core/env";

export type QqContactKind = "private" | "group";

export type ParsedQqContactId = {
  kind: QqContactKind;
  id: string;
};

type OneBotResponse<T = unknown> = {
  status?: string;
  retcode?: number;
  data?: T;
  message?: string;
  wording?: string;
};

let lastError: string | null = null;

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

  try {
    if (parsed.kind === "private") {
      await onebotAction("send_private_msg", {
        user_id: toOnebotId(parsed.id),
        message: text,
      });
    } else {
      await onebotAction("send_group_msg", {
        group_id: toOnebotId(parsed.id),
        message: text,
      });
    }
    lastError = null;
    return true;
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    console.warn("[QQ] Failed to send text:", lastError);
    return false;
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
    const loginInfo = await onebotAction<{ user_id?: number | string; nickname?: string }>("get_login_info");
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
