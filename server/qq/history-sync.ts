import { ENV } from "../_core/env";
import * as db from "../db";
import { handleQqOneBotEvent, type OneBotMessageEvent } from "./message-handler";
import {
  getQqFriendMessageHistory,
  getQqLoginInfo,
  parseQqContactId,
  type QqFriendHistoryMessage,
} from "./onebot-client";
import { countSeenQqMessages, hasSeenQqMessage, markQqMessageSeen } from "./message-dedupe";

let timer: NodeJS.Timeout | null = null;
let running = false;

function normalizeContactId(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^qq:private:.+$/i.test(trimmed)) return trimmed;
  if (/^private:.+$/i.test(trimmed)) return `qq:${trimmed}`;
  if (/^\d+$/.test(trimmed)) return `qq:private:${trimmed}`;
  return null;
}

function configuredContacts(): string[] {
  return ENV.qqHistorySyncContacts
    .split(/[,\s]+/)
    .map(normalizeContactId)
    .filter((contactId): contactId is string => Boolean(contactId));
}

async function targetContacts(): Promise<string[]> {
  const contacts = new Set(configuredContacts());
  try {
    for (const contactId of await db.listActiveQqBindingContactIds()) {
      const normalized = normalizeContactId(contactId);
      if (normalized) contacts.add(normalized);
    }
  } catch (err) {
    console.warn("[QQ] History sync failed to list active bindings:", err instanceof Error ? err.message : String(err));
  }
  return Array.from(contacts);
}

function senderIdOf(message: QqFriendHistoryMessage): string {
  return String(message.sender?.user_id ?? message.user_id ?? "").trim();
}

function messageIdOf(message: QqFriendHistoryMessage): string {
  return String(message.message_id ?? "").trim();
}

function contactNameOf(message: QqFriendHistoryMessage, fallback: string): string {
  return message.sender?.card?.trim()
    || message.sender?.nickname?.trim()
    || fallback;
}

function toOneBotEvent(contactUserId: string, message: QqFriendHistoryMessage, selfId: string): OneBotMessageEvent {
  return {
    post_type: "message",
    message_type: "private",
    sub_type: message.sub_type || "friend",
    self_id: selfId,
    user_id: contactUserId,
    message_id: message.message_id,
    message: message.message,
    raw_message: message.raw_message,
    sender: {
      ...message.sender,
      user_id: contactUserId,
    },
  };
}

async function syncContact(contactId: string, selfId: string): Promise<void> {
  const parsed = parseQqContactId(contactId);
  if (!parsed || parsed.kind !== "private") return;

  const messages = await getQqFriendMessageHistory(parsed.id, ENV.qqHistorySyncHistoryCount);
  if (!messages?.length) return;

  const seenCount = await countSeenQqMessages(contactId);
  const firstSeenForContact = seenCount === 0;
  const incoming = messages
    .slice()
    .sort((a, b) => (a.time ?? 0) - (b.time ?? 0))
    .filter(message => messageIdOf(message))
    .filter(message => senderIdOf(message) !== selfId)
    .filter(message => senderIdOf(message) === String(parsed.id))
    .filter(message => message.message_type == null || message.message_type === "private");

  const unseen: QqFriendHistoryMessage[] = [];
  for (const message of incoming) {
    const messageId = messageIdOf(message);
    if (await hasSeenQqMessage(contactId, messageId)) continue;
    unseen.push(message);
  }

  if (firstSeenForContact) {
    const latestQqMessageAt = await db.getLatestQqMessageCreatedAt();
    const latestQqMessageMs = latestQqMessageAt?.getTime() ?? Date.now();
    const missedAfterDatabase = unseen.filter(message => {
      if (!message.time) return false;
      return (message.time * 1000) > latestQqMessageMs + 1000;
    });
    const selectedInitial = missedAfterDatabase.slice(-Math.max(1, ENV.qqHistorySyncMaxBackfillPerContact));
    const selectedIds = new Set(selectedInitial.map(messageIdOf));
    for (const message of messages) {
      if (!selectedIds.has(messageIdOf(message))) await markQqMessageSeen(contactId, message.message_id);
    }
    if (selectedInitial.length === 0) {
      console.info(`[QQ] History sync initialized baseline contact=${contactId} messages=${messages.length} incoming=${incoming.length}`);
      return;
    }
    console.info(`[QQ] History sync initial backfill contact=${contactId} messages=${selectedInitial.length}`);
    for (const message of selectedInitial) {
      const event = toOneBotEvent(parsed.id, message, selfId);
      event.sender = {
        ...event.sender,
        nickname: contactNameOf(message, parsed.id),
      };
      await handleQqOneBotEvent(event);
    }
    return;
  }

  const selected = unseen.slice(-Math.max(1, ENV.qqHistorySyncMaxBackfillPerContact));
  if (selected.length === 0) return;

  console.info(`[QQ] History sync backfilling contact=${contactId} messages=${selected.length}`);
  for (const message of selected) {
    const event = toOneBotEvent(parsed.id, message, selfId);
    event.sender = {
      ...event.sender,
      nickname: contactNameOf(message, parsed.id),
    };
    await handleQqOneBotEvent(event);
  }
}

async function runOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const loginInfo = await getQqLoginInfo();
    const selfId = String(loginInfo?.user_id ?? "").trim();
    if (!selfId) return;

    const contacts = await targetContacts();
    for (const contactId of contacts) {
      await syncContact(contactId, selfId);
    }
  } catch (err) {
    console.warn("[QQ] History sync tick failed:", err instanceof Error ? err.message : String(err));
  } finally {
    running = false;
  }
}

export function startQqHistorySync() {
  if (!ENV.qqEnabled || !ENV.qqHistorySyncEnabled) return;
  if (timer) return;

  const intervalMs = Math.max(15, ENV.qqHistorySyncIntervalSeconds) * 1000;
  timer = setInterval(() => {
    void runOnce();
  }, intervalMs);
  timer.unref?.();
  console.info(`[QQ] History sync started interval=${Math.round(intervalMs / 1000)}s`);
  void runOnce();
}
