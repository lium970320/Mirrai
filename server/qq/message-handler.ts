import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { ENV } from "../_core/env";
import { enqueueWechatTextMessage, type BatchedTextMessage } from "../wechat/incoming-message-batcher";
import { sayWeChatReply } from "../wechat/reply-sender";
import { recordRecentQqContact } from "./contact-registry";
import { handleQqPersonaChat, handleQqPersonaMediaChat, type QqMediaInput } from "./persona-bridge";
import { getQqRecordFile, sendQqText, type QqRecordFileInfo } from "./onebot-client";
import { normalizeAudioForAsr } from "../voice/audio-normalizer";
import { transcribeWithZhipuAsr } from "../voice/zhipu-asr";

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

function sanitizeFileName(fileName: string, fallback: string): string {
  const safe = fileName
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return safe || fallback;
}

function inferMimeType(fileNameOrUrl: string | undefined): string {
  const lower = (fileNameOrUrl ?? "").toLowerCase();
  if (lower.includes(".png")) return "image/png";
  if (lower.includes(".gif")) return "image/gif";
  if (lower.includes(".webp")) return "image/webp";
  if (lower.includes(".jpeg") || lower.includes(".jpg")) return "image/jpeg";
  return "image/jpeg";
}

function inferAudioMimeType(fileNameOrUrl: string | undefined): string {
  const lower = (fileNameOrUrl ?? "").toLowerCase();
  if (lower.includes(".wav")) return "audio/wav";
  if (lower.includes(".mp3")) return "audio/mpeg";
  if (lower.includes(".m4a")) return "audio/mp4";
  if (lower.includes(".ogg")) return "audio/ogg";
  if (lower.includes(".flac")) return "audio/flac";
  if (lower.includes(".amr")) return "audio/amr";
  return "audio/mpeg";
}

function detectImageMimeType(buffer: Buffer, fallback: string): string {
  if (buffer.byteLength >= 6 && buffer.subarray(0, 6).toString("ascii").startsWith("GIF8")) return "image/gif";
  if (buffer.byteLength >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.byteLength >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.byteLength >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return fallback;
}

function imageExtension(mimeType: string): string {
  if (mimeType === "image/gif") return ".gif";
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  return ".jpg";
}

function stringData(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeUrl(url: string | undefined): string | undefined {
  const trimmed = url?.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return undefined;
}

function parseCqParams(text: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const part of text.split(",")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) params[key] = value;
  }
  return params;
}

function extractCqImageSegments(text: string): OneBotMessageSegment[] {
  const segments: OneBotMessageSegment[] = [];
  const regex = /\[CQ:image,([^\]]+)\]/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    segments.push({
      type: "image",
      data: parseCqParams(match[1]),
    });
  }
  return segments;
}

function extractCqRecordSegments(text: string): OneBotMessageSegment[] {
  const segments: OneBotMessageSegment[] = [];
  const regex = /\[CQ:record,([^\]]+)\]/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    segments.push({
      type: "record",
      data: parseCqParams(match[1]),
    });
  }
  return segments;
}

export function extractQqImageSegments(message: unknown, rawMessage?: string): OneBotMessageSegment[] {
  if (Array.isArray(message)) {
    return (message as OneBotMessageSegment[])
      .filter(segment => segment?.type === "image");
  }
  if (typeof message === "string") return extractCqImageSegments(message);
  return rawMessage ? extractCqImageSegments(rawMessage) : [];
}

export function extractQqRecordSegments(message: unknown, rawMessage?: string): OneBotMessageSegment[] {
  if (Array.isArray(message)) {
    return (message as OneBotMessageSegment[])
      .filter(segment => segment?.type === "record");
  }
  if (typeof message === "string") return extractCqRecordSegments(message);
  return rawMessage ? extractCqRecordSegments(rawMessage) : [];
}

function isLikelyEmoticon(segment: OneBotMessageSegment, mimeType: string, fileName: string): boolean {
  const data = segment.data ?? {};
  const hint = [
    stringData(data, "summary"),
    stringData(data, "sub_type"),
    stringData(data, "subType"),
    stringData(data, "image_type"),
    stringData(data, "type"),
    fileName,
    mimeType,
  ].filter(Boolean).join(" ").toLowerCase();
  return /表情|动画|sticker|emoticon|emoji|face|marketface|gif/.test(hint);
}

function qqMediaFetchHeaders(url: string): Record<string, string> {
  if (!ENV.qqOnebotAccessToken) return {};
  const base = ENV.qqOnebotBaseUrl.replace(/\/+$/, "");
  if (!url.startsWith(base)) return {};
  return { authorization: `Bearer ${ENV.qqOnebotAccessToken}` };
}

async function downloadImageUrl(url: string): Promise<{ buffer: Buffer; mimeType?: string }> {
  const response = await fetch(url, { headers: qqMediaFetchHeaders(url) });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    mimeType: response.headers.get("content-type") ?? undefined,
  };
}

async function readLocalImagePath(filePath: string): Promise<{ buffer: Buffer; mimeType?: string }> {
  const absolutePath = path.resolve(filePath);
  return {
    buffer: await fs.readFile(absolutePath),
    mimeType: inferMimeType(absolutePath),
  };
}

function recordFileName(info: QqRecordFileInfo, fallback: string): string {
  return sanitizeFileName(
    info.file_name
      || (info.file ? path.basename(info.file) : "")
      || (info.url ? path.basename(new URL(info.url).pathname) : "")
      || fallback,
    fallback,
  );
}

async function resolveQqRecordInfo(segment: OneBotMessageSegment): Promise<QqRecordFileInfo | null> {
  const data = segment.data ?? {};
  const file = stringData(data, "file");
  const localPath = stringData(data, "path");
  const fileId = stringData(data, "file_id") || stringData(data, "fileId");
  const base64 = file?.startsWith("base64://") ? file.slice("base64://".length) : undefined;
  const directUrl = normalizeUrl(stringData(data, "url") || stringData(data, "file_url"));
  if (base64) return { base64 };
  if (localPath || directUrl) {
    return {
      file: localPath,
      url: directUrl,
      file_name: file || (localPath ? path.basename(localPath) : undefined),
    };
  }
  if (!file && !fileId) {
    return null;
  }
  return (await getQqRecordFile({ file, fileId, outFormat: "mp3" })) ?? (file ? { file } : null);
}

async function readQqVoiceSource(
  info: QqRecordFileInfo,
  fallbackMimeType: string,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  if (info.base64) {
    return {
      buffer: Buffer.from(info.base64, "base64"),
      mimeType: fallbackMimeType,
    };
  }

  if (info.file) {
    try {
      if (normalizeUrl(info.file)) {
        const downloaded = await downloadImageUrl(info.file);
        return {
          buffer: downloaded.buffer,
          mimeType: downloaded.mimeType?.startsWith("audio/") ? downloaded.mimeType : fallbackMimeType,
        };
      }
      const localPath = info.file.startsWith("file://") ? fileURLToPath(info.file) : info.file;
      if (path.isAbsolute(localPath) || /^[a-z]:[\\/]/i.test(localPath)) {
        return {
          buffer: await fs.readFile(localPath),
          mimeType: inferAudioMimeType(localPath),
        };
      }
      const resolvedPath = path.resolve(localPath);
      return {
        buffer: await fs.readFile(resolvedPath),
        mimeType: inferAudioMimeType(resolvedPath),
      };
    } catch (err) {
      if (!info.url) throw err;
      console.warn("voice_in_download_failed platform=qq route=file fallback=url", err);
    }
  }

  if (info.url) {
    const downloaded = await downloadImageUrl(info.url);
    return {
      buffer: downloaded.buffer,
      mimeType: downloaded.mimeType?.startsWith("audio/") ? downloaded.mimeType : fallbackMimeType,
    };
  }

  return null;
}

async function extractQqVoiceFromSegment(
  segment: OneBotMessageSegment,
  event: OneBotMessageEvent,
): Promise<{ buffer: Buffer; fileName: string; mimeType: string } | null> {
  console.info(`voice_in_received platform=qq messageId=${event.message_id ?? ""}`);
  const info = await resolveQqRecordInfo(segment);
  if (!info) {
    console.warn(`voice_in_download_failed platform=qq messageId=${event.message_id ?? ""} reason=no_record_info`);
    return null;
  }

  const fallbackName = `qq-voice-${event.message_id ?? Date.now()}.mp3`;
  const fileName = recordFileName(info, fallbackName);
  let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let mimeType = inferAudioMimeType(fileName);

  try {
    const source = await readQqVoiceSource(info, mimeType);
    if (source) {
      buffer = source.buffer;
      mimeType = source.mimeType;
    }
  } catch (err) {
    console.warn(`voice_in_download_failed platform=qq messageId=${event.message_id ?? ""}`, err);
    return null;
  }

  if (buffer.byteLength === 0) {
    console.warn(`voice_in_download_failed platform=qq messageId=${event.message_id ?? ""} reason=empty_audio`);
    return null;
  }

  console.info(`voice_in_download_success platform=qq messageId=${event.message_id ?? ""} bytes=${buffer.byteLength}`);
  return { buffer, fileName, mimeType };
}

async function extractQqMediaFromSegment(
  segment: OneBotMessageSegment,
  event: OneBotMessageEvent,
  index: number,
  caption?: string,
): Promise<QqMediaInput | null> {
  const data = segment.data ?? {};
  const url = normalizeUrl(stringData(data, "url") || stringData(data, "file_url"));
  const file = stringData(data, "file") || stringData(data, "path");
  const base64 = file?.startsWith("base64://") ? file.slice("base64://".length) : undefined;
  let buffer: Buffer = Buffer.alloc(0);
  let sourceUrl: string | undefined;
  const sourceName = file || url || `qq-image-${event.message_id ?? Date.now()}-${index + 1}.jpg`;
  let mimeType = inferMimeType(sourceName);

  try {
    if (base64) {
      buffer = Buffer.from(base64, "base64");
    } else if (url) {
      const downloaded = await downloadImageUrl(url);
      buffer = downloaded.buffer;
      mimeType = downloaded.mimeType || mimeType;
      sourceUrl = url;
    } else if (file && (path.isAbsolute(file) || /^[a-z]:[\\/]/i.test(file))) {
      const local = await readLocalImagePath(file);
      buffer = local.buffer;
      mimeType = local.mimeType || mimeType;
    }
  } catch (err) {
    console.warn(`[QQ] Failed to download image segment ${index + 1}:`, err);
    if (url) sourceUrl = url;
  }

  const resolvedMime = detectImageMimeType(buffer, mimeType);
  const fileName = sanitizeFileName(
    path.basename(sourceName).replace(/\.(?:jpg|jpeg|png|gif|webp)$/i, imageExtension(resolvedMime)),
    `qq-image-${event.message_id ?? Date.now()}-${index + 1}${imageExtension(resolvedMime)}`,
  );

  if (buffer.byteLength === 0 && !sourceUrl) {
    console.warn(`[QQ] Image segment ${index + 1} has no usable URL, base64 data, or local file path.`);
    return null;
  }

  const kind = isLikelyEmoticon(segment, resolvedMime, fileName) ? "emoticon" : "image";
  console.info(
    `[QQ] Received ${kind} media: ${fileName}, ${resolvedMime}, ${buffer.byteLength} bytes, sourceUrl=${sourceUrl ? "yes" : "no"}`,
  );

  return {
    kind,
    buffer,
    fileName,
    mimeType: resolvedMime,
    sourceUrl,
    caption,
  };
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

function cleanCaptionText(content: string): string {
  return content
    .replace(/\[图片\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

async function sayQqReply(contactId: string, reply: string): Promise<void> {
  await sayWeChatReply({
    say: async (text: string) => {
      const sent = await sendQqText(contactId, text);
      if (!sent) throw new Error("QQ text send failed");
    },
  }, reply);
}

async function sendVoiceFallback(contactId: string, text = "这条语音我没听清，你再发一次。"): Promise<void> {
  await sayQqReply(contactId, text);
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
  const imageSegments = extractQqImageSegments(event.message, event.raw_message);
  const recordSegments = extractQqRecordSegments(event.message, event.raw_message);
  if (!content && imageSegments.length === 0 && recordSegments.length === 0) {
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
    messageText: content || (recordSegments.length > 0 ? "[语音]" : "[图片]"),
  });

  if (recordSegments.length > 0) {
    const voice = await extractQqVoiceFromSegment(recordSegments[0], event);
    if (!voice) {
      await sendVoiceFallback(contactId);
      return { handled: true as const, reason: "voice_download_failed" as const };
    }

    const normalized = await normalizeAudioForAsr(voice.buffer, voice.fileName, voice.mimeType);
    if (!normalized.ok) {
      await sendVoiceFallback(contactId, "这条语音格式我暂时解析不了，你再发一次。");
      return { handled: true as const, reason: normalized.status };
    }

    const asr = await transcribeWithZhipuAsr({
      buffer: normalized.buffer,
      fileName: normalized.fileName,
      mimeType: normalized.mimeType,
      hotwords: ["敏子", "王芃泽", "王玉柱", "柱子", "武汉纺织大学", "南京研究所", "老鹰峡"],
      userId: contactId,
    });
    if (!asr.ok) {
      await sendVoiceFallback(contactId);
      return { handled: true as const, reason: asr.status };
    }

    const transcript = asr.transcript.trim();
    recordRecentQqContact({
      id: contactId,
      name: displayName,
      kind,
      messageText: `[语音] ${transcript}`,
    });

    const reply = await handleQqPersonaChat(contactId, nameForPrompt, transcript, {
      batchMessageCount: 1,
      batchMessages: [transcript],
    });
    if (reply) await sayQqReply(contactId, reply);
    return { handled: true as const };
  }

  if (imageSegments.length > 0) {
    const caption = cleanCaptionText(content);
    console.info(`[QQ] Handling image message contact=${contactId} messageId=${event.message_id ?? ""} images=${imageSegments.length}`);

    const media = await extractQqMediaFromSegment(imageSegments[0], event, 0, caption || undefined);
    if (media) {
      const reply = await handleQqPersonaMediaChat(contactId, nameForPrompt, media);
      if (reply) {
        await sayQqReply(contactId, reply);
      }
      return { handled: true as const };
    }

    console.warn(`[QQ] Falling back to text-only image placeholder contact=${contactId}`);
  }

  if (!content) {
    return { handled: true as const, reason: "image_without_usable_content" as const };
  }

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
