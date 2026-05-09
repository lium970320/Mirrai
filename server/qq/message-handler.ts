import { ENV } from "../_core/env";
import { enqueueWechatTextMessage, type BatchedTextMessage } from "../wechat/incoming-message-batcher";
import { sayWeChatReply } from "../wechat/reply-sender";
import { recordRecentQqContact } from "./contact-registry";
import { handleQqPersonaChat } from "./persona-bridge";
import { sendQqText } from "./onebot-client";

export type OneBotMessageSegment = {
  type: string;
  data?: Record<string, unknown>;
};

export type OneBotMessageEvent = {
  post_type?: string;
  message_type?: "private" | "group" | string;
  sub_type?: string;
  self_id?: number | string;
  user_id?: number | string;
  group_id?: number | string;
  message_id?: number | string;
  message?: string | OneBotMessageSegment[];
  raw_message?: string;
  sender?: {
    nickname?: string;
    card?: string;
    user_id?: number | string;
  };
};

function normalizeMessageText(text: string): string {
  return text
    .replace(/\[CQ:image[^\]]*\]/gi, " [图片] ")
    .replace(/\[CQ:face[^\]]*\]/gi, " [表情] ")
    .replace(/\[CQ:record[^\]]*\]/gi, " [语音] ")
    .replace(/\[CQ:video[^\]]*\]/gi, " [视频] ")
    .replace(/\[CQ:at,qq=([^\],]+)[^\]]*\]/gi, " @$1 ")
    .replace(/\[CQ:[^\]]+\]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function segmentText(segment: OneBotMessageSegment): string {
  const data = segment.data ?? {};
  switch (segment.type) {
    case "text":
      return typeof data.text === "string" ? data.text : "";
    case "image":
      return "[图片]";
    case "face":
      return "[表情]";
    case "record":
      return "[语音]";
    case "video":
      return "[视频]";
    case "at":
      return data.qq ? `@${String(data.qq)}` : "";
    case "file":
      return "[文件]";
    case "json":
    case "xml":
      return "[卡片消息]";
    default:
      return "";
  }
}

export function extractQqPlainText(message: unknown, rawMessage?: string): string {
  if (typeof message === "string") return normalizeMessageText(message);
  if (Array.isArray(message)) {
    return normalizeMessageText(message.map(segment => segmentText(segment as OneBotMessageSegment)).join(" "));
  }
  return normalizeMessageText(rawMessage ?? "");
}

export function buildQqContactKey(event: OneBotMessageEvent): string | null {
  if (event.message_type === "private" && event.user_id != null) {
    return `qq:private:${String(event.user_id)}`;
  }
  if (event.message_type === "group" && event.group_id != null) {
    return `qq:group:${String(event.group_id)}`;
  }
  return null;
}

function senderName(event: OneBotMessageEvent): string {
  return event.sender?.card?.trim()
    || event.sender?.nickname?.trim()
    || (event.user_id != null ? `QQ ${String(event.user_id)}` : "QQ 用户");
}

function contactDisplayName(event: OneBotMessageEvent): string {
  if (event.message_type === "group") {
    return `QQ群 ${String(event.group_id ?? "")}`.trim();
  }
  return senderName(event);
}

async function handleTextBatch(batch: BatchedTextMessage): Promise<void> {
  const reply = await handleQqPersonaChat(batch.contactId, batch.contactName, batch.combinedText, {
    batchMessageCount: batch.messageCount,
    batchMessages: batch.messages,
  });
  if (reply) {
    await sayWeChatReply(batch.contact, reply);
  }
}

export async function handleQqOneBotEvent(event: OneBotMessageEvent) {
  if (event.post_type && event.post_type !== "message") {
    return { handled: false, reason: "ignored_post_type" as const };
  }
  if (event.self_id != null && event.user_id != null && String(event.self_id) === String(event.user_id)) {
    return { handled: false, reason: "ignored_self_message" as const };
  }
  if (event.message_type === "group" && !ENV.qqAllowGroups) {
    return { handled: false, reason: "group_disabled" as const };
  }

  const contactId = buildQqContactKey(event);
  if (!contactId) {
    return { handled: false, reason: "unsupported_message_type" as const };
  }

  const content = extractQqPlainText(event.message, event.raw_message);
  if (!content) {
    return { handled: false, reason: "empty_message" as const };
  }

  const kind = event.message_type === "group" ? "group" : "private";
  const displayName = contactDisplayName(event);
  const nameForPrompt = event.message_type === "group"
    ? `${senderName(event)}（${displayName}）`
    : displayName;

  recordRecentQqContact({
    id: contactId,
    name: displayName,
    kind,
    messageText: content,
  });

  console.info(`[QQ] Queued message contact=${contactId} messageId=${event.message_id ?? ""}`);
  enqueueWechatTextMessage({
    contact: {
      say: async (text: string) => {
        const sent = await sendQqText(contactId, text);
        if (!sent) throw new Error("QQ text send failed");
      },
    },
    contactId,
    contactName: nameForPrompt,
    text: content,
    onBatch: handleTextBatch,
  });

  return { handled: true as const };
}
