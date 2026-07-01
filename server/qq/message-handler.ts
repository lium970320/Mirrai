import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { ENV } from "../_core/env";
import { recordOperationsEvent } from "../_core/operations-events";
import { generateTTSFile } from "../_core/tts";
import { splitAssistantReplyForChat, splitImmersiveReplyForChat, stripReplyDecorativeQuotes } from "../_core/reply-utils";
import { enqueueSocialTextMessage, type BatchedTextMessage } from "../social/incoming-message-batcher";
import { saySocialReply } from "../social/reply-sender";
import { computeReplyLatencyMs, isReplyLatencyEnabled } from "../social/reply-latency";
import { recordRecentQqContact } from "./contact-registry";
import { handleQqPersonaChatDetailed, handleQqPersonaMediaChat, type QqMediaInput } from "./persona-bridge";
import { tryHandleSceneCommand, getSceneMode, getDualMode } from "./scene-commands";
import { generateContinuationGuidance } from "./continuation-guidance";
import { wantsKeepGoing, keepGoingBeats } from "../social/persona-turn-planner";
import { decideSelfieOpportunity, isSelfieCooldownActive } from "../social/selfie-decision";
import { pickSelfieDeliveryLine } from "../social/selfie-delivery";
import { getSelfieCooldown, recordSelfieSent } from "../social/selfie-cooldown";
import { generatePersonaPhoto, type PersonaPhotoRequest } from "../image/selfie-provider";
import { getQqRecordFile, parseQqContactId, sendQqImageFile, sendQqRecordFile, sendQqText, type QqRecordFileInfo } from "./onebot-client";
import { normalizeAudioForAsr } from "../voice/audio-normalizer";
import { transcribeWithZhipuAsr } from "../voice/zhipu-asr";
import { checkVoiceReplyPolicy, markVoiceReplySent, type VoiceReplySource, type VoiceRequestDecision } from "../voice/voice-reply-policy";
import { detectStickerIntent } from "../stickers/sticker-intent";
import { checkStickerReplyPolicy, markStickerReplySent } from "../stickers/sticker-policy";
import { selectSticker, markStickerSent } from "../stickers/sticker-selector";
import { sendQqSticker } from "../stickers/sticker-sender";
import { hasSeenQqMessage, markQqMessageSeen } from "./message-dedupe";

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
  const fallbackName = `qq-image-${event.message_id ?? Date.now()}-${index + 1}.jpg`;
  const sourceName = base64 ? fallbackName : (file || url || fallbackName);
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
  // 拍照意图门控：冷却内不让 LLM 输出 [[PHOTO]]（明确指令仍走规则、破冷却）；作息门控在 persona-text-chat 内。
  const allowPhotoIntent = !isSelfieCooldownActive(getSelfieCooldown(batch.contactId));
  const result = await handleQqPersonaChatDetailed(batch.contactId, batch.contactName, batch.combinedText, {
    batchMessageCount: batch.messageCount,
    batchMessages: batch.messages,
    shouldAbortReply: batch.isStale,
    allowPhotoIntent,
  });
  if (result?.replyText) {
    if (batch.isStale()) {
      console.info(`[QQ] Discarded stale text reply contact=${batch.contactId}; newer message is pending.`);
      return;
    }
    // 拟人回应节奏（默认关）：忙碌时段隔一会才发，由既有 isStale 守住期间的新消息。
    if (isReplyLatencyEnabled()) {
      const latencyMs = computeReplyLatencyMs(result.turnPlan.availability);
      if (latencyMs > 0) await new Promise(resolve => setTimeout(resolve, latencyMs));
    }
    await sayQqReplyWithOptionalVoice(batch.contactId, result.replyText, {
      source: "text",
      inputText: batch.combinedText,
      voiceRequestDecision: result.voiceRequestDecision,
      shouldAbort: batch.isStale,
      immersiveMode: result.immersiveMode,
    });

    // 拍照：文字已发，图后台生成完再追发。两条路：
    // ① LLM 自然想拍 → result.photoIntent（已被 allowPhotoIntent 按冷却/作息门控）；
    // ② 否则规则版「明确要」（发自拍 / 拍家里）→ 必发、破冷却。
    // 明确指令（发自拍/拍家里）无论是否在冷却都算 explicit_request：生成失败时要补一句、不静默。
    const explicit = decideSelfieOpportunity({ inputText: batch.combinedText });
    if (result.photoIntent) {
      // LLM 自然想拍：用它写的画面；若这同时是用户的明确指令，则按 explicit_request 处理（失败有补救句）。
      void generateAndSendPhoto(batch.contactId, {
        prompt: result.photoIntent.scene,
        includeFace: result.photoIntent.includeFace,
        atHome: result.photoIntent.atHome,
      }, explicit.shouldSend ? explicit.reason : "spontaneous", batch.isStale, result.immersiveMode);
    } else if (explicit.shouldSend) {
      void generateAndSendPhoto(
        batch.contactId,
        explicit.kind === "environment"
          ? { prompt: explicit.situation, atHome: true }
          : { prompt: explicit.situation, includeFace: true, withPartner: explicit.withPartner },
        explicit.reason,
        batch.isStale,
        result.immersiveMode,
      );
    }

    // 「不要停」连发：自动续写若干拍，每拍一次完整生成；用户插话（isStale）或写空就停。
    const keepGoingBeatCount = keepGoingBeats(batch.combinedText);
    if (keepGoingBeatCount > 0) {
      const dual = getDualMode(batch.contactId);
      let lastReply = result.replyText;
      for (let beat = 0; beat < keepGoingBeatCount; beat++) {
        if (batch.isStale()) break;
        // 先替用户生成一条「引导」——联系首条消息和人物上一拍、每次不同——再驱动续写。
        const guidance = await generateContinuationGuidance(batch.contactId, batch.combinedText, lastReply, dual);
        const direction = guidance ?? (dual ? "顺着上一拍自然往下、多写对方的身体反应" : "顺着上一拍自然往下");
        const tail = dual
          ? "据此往下推进：把动作、神态、场景都写进【】旁白里，详细写双方动作、尤其多写对方的身体反应；说出口的台词只写你自己的、绝不替对方写。旁白为主，每段【】单独成段，旁白和说出口的话各自成段、空行分开，别收尾"
          : "据此往下推进：把动作、神态、场景都写进【】旁白里；旁白和说出口的话各自成段、每段【】单独成段、空行分开，只演你自己这一方、不替对方说话，别收尾";
        // guidance 是「剧情方向」，必须明确标注，否则它那句第三人称叙述会被 LLM 当成范本照着续写、丢掉【】格式。
        const continuationCue = `（剧情往这个方向走：${direction}。${tail}）`;
        const cont = await handleQqPersonaChatDetailed(
          batch.contactId,
          batch.contactName,
          continuationCue,
          { shouldAbortReply: batch.isStale },
        );
        if (!cont?.replyText || batch.isStale()) break;
        await sayQqReplyWithOptionalVoice(batch.contactId, cont.replyText, {
          source: "text",
          inputText: batch.combinedText,
          shouldAbort: batch.isStale,
          immersiveMode: cont.immersiveMode,
        });
        lastReply = cont.replyText;
      }
    }
  }
}

// 拍照：文字回复已发，这里后台生成图、好了再追发。明确要的失败时补一句，自然想拍（spontaneous）的失败则静默。
async function generateAndSendPhoto(
  contactId: string,
  req: PersonaPhotoRequest,
  reason: string,
  shouldAbort?: () => boolean,
  immersive?: boolean,
): Promise<void> {
  try {
    const result = await generatePersonaPhoto(req);
    if (shouldAbort?.()) return;
    if (result) {
      const ok = await sendQqImageFile(contactId, result.imagePath);
      if (ok) {
        recordSelfieSent(contactId);
        // 交付信号：图已送到，紧跟一句让对方看（与文字「预告」闭环成三段式）。
        // 口吻按三态选：带人=自拍 / 不带人但在家=环境 / 不带人也不在家（路上·物）=通用，避免外景说成「家里」。
        if (!shouldAbort?.()) {
          const deliveryKind = req.includeFace ? "selfie" : req.atHome ? "environment" : "scene";
          // 场景模式：交付句带【】动作旁白（拍照动作描写挪到图到达这一刻，不在预告里演）。
          await sendQqText(contactId, pickSelfieDeliveryLine(deliveryKind, contactId, undefined, immersive ?? getSceneMode(contactId)));
        }
        return;
      }
    }
    if (reason === "explicit_request") {
      await sendQqText(contactId, "诶，刚没拍好，等会儿补一张给你。");
    }
  } catch (err) {
    console.warn(`[QQ] photo generate/send failed contact=${contactId}:`, err);
    if (reason === "explicit_request") {
      await sendQqText(contactId, "拍照出了点小状况，等会儿再说哈。");
    }
  }
}

const SCENE_SPLIT_OPTIONS = {
  softLimit: 600,
  hardLimit: 700,
  maxMessages: 30,
  maxSentencesPerMessage: 99,
  keepParagraphs: true,
  immersiveAside: true,
};

async function sayQqReply(
  contactId: string,
  reply: string,
  options: { shouldAbort?: () => boolean; inputText?: string; immersiveMode?: boolean } = {},
): Promise<void> {
  const keepGoing = !!options.inputText && wantsKeepGoing(options.inputText);
  // 沉浸拆条用权威 immersiveMode（生成层 result 算定），缺省回退内存 getSceneMode（主动消息等无 result 的调用点）。
  const immersive = options.immersiveMode ?? getSceneMode(contactId);
  const splitOptions = (immersive || keepGoing) ? SCENE_SPLIT_OPTIONS : undefined;
  await saySocialReply({
    say: async (text: string) => {
      const sent = await sendQqText(contactId, text);
      if (!sent) throw new Error("QQ text send failed");
    },
  }, reply, { shouldAbort: options.shouldAbort, splitOptions });
}

async function sayQqReplyWithOptionalSticker(
  contactId: string,
  reply: string,
  context: { inputText: string; userSentSticker?: boolean; shouldAbort?: () => boolean; immersiveMode?: boolean },
): Promise<void> {
  await sayQqReply(contactId, reply, { shouldAbort: context.shouldAbort, inputText: context.inputText, immersiveMode: context.immersiveMode });
  if (context.shouldAbort?.()) {
    console.info(`[QQ] Discarded stale sticker reply contact=${contactId}; newer message is pending.`);
    return;
  }

  const parsed = parseQqContactId(contactId);
  const stickerIntent = detectStickerIntent({
    inputText: context.inputText,
    replyText: reply,
    userSentSticker: context.userSentSticker,
  });
  const policy = checkStickerReplyPolicy({
    contactId,
    contactKind: parsed?.kind ?? "private",
    inputText: context.inputText,
    replyText: reply,
    userSentSticker: context.userSentSticker,
    stickerIntent,
  });

  if (!policy.shouldSendSticker) {
    console.info(policy.reason);
    return;
  }

  const selected = selectSticker({ contactId, stickerIntent });
  if (!selected.ok) {
    console.warn(`sticker_not_found platform=qq contact=${contactId} reason=${selected.reason}`);
    recordOperationsEvent({
      id: "stickers.selection_not_found",
      scope: "stickers",
      title: "表情包素材未匹配",
      detail: "表情包策略允许发送，但素材库没有可用匹配文件；主文字回复会保留。",
      evidence: `contact=${contactId} reason=${selected.reason}`,
    });
    return;
  }

  if (context.shouldAbort?.()) {
    console.info(`[QQ] Discarded stale sticker reply before send contact=${contactId}; newer message is pending.`);
    return;
  }

  const sent = await sendQqSticker(contactId, selected.sticker);
  if (!sent.ok) {
    console.warn(`sticker_send_failed_fallback_text platform=qq contact=${contactId} reason=${sent.reason}`);
    return;
  }

  markStickerReplySent(contactId);
  markStickerSent(contactId, selected.sticker.id);
}

function voiceTextFromReply(reply: string): string {
  const plain = stripReplyDecorativeQuotes(reply)
    .replace(/【[^】]*】/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripReplyDecorativeQuotes(plain);
}

const VOICE_DELIVERY_FALLBACK_TEXT = "我这边语音现在没发出来，刚才那句不能当语音听。等语音服务恢复了我再发。";

function isExplicitVoiceRequestPolicy(policyReason: string): boolean {
  return policyReason === "voice_reply_selected_by_request";
}

function looksLikeSimulatedVoiceNarration(reply: string): boolean {
  const text = voiceTextFromReply(reply).replace(/\s+/g, "");
  if (!text) return false;

  return [
    /(?:发来|发了|发送|传来).{0,8}(?:一条|条)?语音(?:消息)?/,
    /语音消息.{0,40}(?:点开|打开|听到|听见|声音|嗓音)/,
    /(?:点开|打开).{0,40}(?:声音|嗓音|听到|听见)/,
    /[（(].{0,120}(?:语音|点开|打开).{0,120}(?:声音|嗓音|听到|听见).{0,120}[）)]/,
  ].some(pattern => pattern.test(text));
}

function voiceFailureFallbackReply(
  reply: string,
  policyReason: string,
  failureKind: "tts_failed" | "record_send_failed",
): {
  text: string;
  explicit: boolean;
  simulatedVoiceNarration: boolean;
  replaced: boolean;
} {
  const explicit = isExplicitVoiceRequestPolicy(policyReason);
  const simulatedVoiceNarration = looksLikeSimulatedVoiceNarration(reply);
  const shouldReplace = simulatedVoiceNarration || (failureKind === "tts_failed" && explicit);
  return {
    text: shouldReplace ? VOICE_DELIVERY_FALLBACK_TEXT : reply,
    explicit,
    simulatedVoiceNarration,
    replaced: shouldReplace,
  };
}

function voiceTtsTimeoutMs(policyReason: string, voiceText: string): number {
  const chars = Array.from(voiceText.replace(/\s+/g, "")).length;
  if (isExplicitVoiceRequestPolicy(policyReason)) {
    if (chars > 120) return Math.max(ENV.voxcpmTimeoutMs, 600_000);
    if (chars > 80) return Math.max(ENV.voxcpmTimeoutMs, 480_000);
    return Math.max(ENV.voxcpmTimeoutMs, 420_000);
  }
  return Math.max(ENV.voxcpmTimeoutMs, 180_000);
}

async function sayQqReplyWithOptionalVoice(
  contactId: string,
  reply: string,
  context: {
    source: VoiceReplySource;
    inputText: string;
    voiceRequestDecision?: VoiceRequestDecision | null;
    shouldAbort?: () => boolean;
    immersiveMode?: boolean;
  },
): Promise<void> {
  const replyChunks = splitAssistantReplyForChat(reply);
  const voiceChunks = replyChunks.map(voiceTextFromReply).filter(Boolean);
  const voiceText = voiceTextFromReply(reply);
  const parsed = parseQqContactId(contactId);
  const policy = await checkVoiceReplyPolicy({
    contactId,
    contactKind: parsed?.kind ?? "private",
    inputText: context.inputText,
    replyText: voiceText,
    replyChunks: voiceChunks,
    source: context.source,
    voiceRequestDecision: context.voiceRequestDecision,
  });

  if (!policy.shouldSendVoice || !voiceText) {
    console.info(policy.reason);
    await sayQqReplyWithOptionalSticker(contactId, reply, {
      inputText: context.inputText,
      shouldAbort: context.shouldAbort,
      immersiveMode: context.immersiveMode,
    });
    return;
  }

  if (context.shouldAbort?.()) {
    console.info(`[QQ] Discarded stale voice reply before TTS contact=${contactId}; newer message is pending.`);
    return;
  }

  // 场景模式语音回复：【】旁白会被 voiceTextFromReply 剥掉、只剩对话进语音，旁白文字会丢失。
  // 所以发语音前，先把旁白作为文字消息单独发出去，再让语音只念说出口的对话。
  if (context.immersiveMode) {
    const asideChunks = splitImmersiveReplyForChat(reply).filter(c => c.startsWith("【") && c.endsWith("】"));
    if (asideChunks.length > 0 && !context.shouldAbort?.()) {
      await sayQqReply(contactId, asideChunks.join("\n\n"), {
        inputText: context.inputText,
        shouldAbort: context.shouldAbort,
      });
    }
  }

  try {
    const forcedByRequest = isExplicitVoiceRequestPolicy(policy.reason);
    const timeoutMs = voiceTtsTimeoutMs(policy.reason, voiceText);
    console.info(`voice_tts_start provider=${ENV.ttsProvider} contact=${contactId} textChunks=${voiceChunks.length} outputChunks=1 forcedByRequest=${forcedByRequest} timeoutMs=${timeoutMs}`);
    const tts = forcedByRequest
      ? await generateTTSFile(voiceText, ENV.qqTtsVoice, undefined, { maxTextLength: null, timeoutMs })
      : await generateTTSFile(voiceText, ENV.qqTtsVoice, undefined, { timeoutMs });
    console.info(`voice_tts_success provider=${tts.provider} voice=${tts.voice} outputChunks=1`);
    if (context.shouldAbort?.()) {
      console.info(`[QQ] Discarded stale voice reply before send contact=${contactId}; newer message is pending.`);
      return;
    }
    const sent = await sendQqRecordFile(contactId, tts.filePath);
    if (!sent) {
      const fallback = voiceFailureFallbackReply(reply, policy.reason, "record_send_failed");
      console.warn(`voice_send_failed_fallback_text platform=qq contact=${contactId} outputChunks=1 explicit=${fallback.explicit} sanitized=${fallback.replaced} simulatedVoiceNarration=${fallback.simulatedVoiceNarration}`);
      recordOperationsEvent({
        id: "voice.qq_record_send_failed",
        scope: "voice",
        title: "QQ 语音发送失败",
        detail: fallback.replaced
          ? "TTS 文件已生成，但 OneBot record 消息发送失败；原回复疑似伪语音叙述，系统会退回安全文字说明。"
          : "TTS 文件已生成，但 OneBot record 消息发送失败，系统会退回文字回复。",
        evidence: `contact=${contactId}`,
      });
      await sayQqReplyWithOptionalSticker(contactId, fallback.text, {
        inputText: context.inputText,
        shouldAbort: context.shouldAbort,
        immersiveMode: context.immersiveMode,
      });
      return;
    }

    console.info(`voice_send_success platform=qq contact=${contactId} outputChunks=1`);
    markVoiceReplySent(contactId);
    return;
  } catch (err) {
    console.warn(`voice_tts_failed provider=${ENV.ttsProvider} contact=${contactId}`, err);
    recordOperationsEvent({
      id: "voice.tts_failed",
      scope: "voice",
      title: "语音生成失败",
      detail: "QQ 语音回复生成过程中失败，系统会退回文字回复。",
      rawError: err,
      evidence: `provider=${ENV.ttsProvider} contact=${contactId}`,
    });
  }

  const fallback = voiceFailureFallbackReply(reply, policy.reason, "tts_failed");
  console.warn(`voice_tts_failed_fallback_text platform=qq contact=${contactId} explicit=${fallback.explicit} sanitized=${fallback.replaced} simulatedVoiceNarration=${fallback.simulatedVoiceNarration}`);
  await sayQqReplyWithOptionalSticker(contactId, fallback.text, {
    inputText: context.inputText,
    shouldAbort: context.shouldAbort,
    immersiveMode: context.immersiveMode,
  });
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
  if (event.message_id != null && await hasSeenQqMessage(contactId, event.message_id)) {
    return { handled: false, reason: "duplicate_message" as const };
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
  await markQqMessageSeen(contactId, event.message_id);

  if (recordSegments.length > 0) {
    const voice = await extractQqVoiceFromSegment(recordSegments[0], event);
    if (!voice) {
      await sendVoiceFallback(contactId);
      return { handled: true as const, reason: "voice_download_failed" as const };
    }

    const normalized = await normalizeAudioForAsr(voice.buffer, voice.fileName, voice.mimeType);
    if (!normalized.ok) {
      console.warn(`voice_in_normalize_failed_fallback_text platform=qq messageId=${event.message_id ?? ""} status=${normalized.status} input=${normalized.inputFormat} reason=${normalized.reason}`);
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
      console.warn(`voice_asr_failed_fallback_text platform=qq messageId=${event.message_id ?? ""} status=${asr.status} model=${asr.model} reason=${asr.reason}`);
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

    const result = await handleQqPersonaChatDetailed(contactId, nameForPrompt, transcript, {
      batchMessageCount: 1,
      batchMessages: [transcript],
    });
    if (result?.replyText) {
      await sayQqReplyWithOptionalVoice(contactId, result.replyText, {
        source: "voice",
        inputText: transcript,
        voiceRequestDecision: result.voiceRequestDecision,
        immersiveMode: result.immersiveMode,
      });
    }
    return { handled: true as const };
  }

  if (imageSegments.length > 0) {
    const caption = cleanCaptionText(content);
    console.info(`[QQ] Handling image message contact=${contactId} messageId=${event.message_id ?? ""} images=${imageSegments.length}`);

    const media = await extractQqMediaFromSegment(imageSegments[0], event, 0, caption || undefined);
    if (media) {
      const reply = await handleQqPersonaMediaChat(contactId, nameForPrompt, media);
      if (reply) {
        await sayQqReplyWithOptionalSticker(contactId, reply, {
          inputText: caption || (media.kind === "emoticon" ? "[表情]" : "[图片]"),
          userSentSticker: media.kind === "emoticon",
        });
      }
      return { handled: true as const };
    }

    console.warn(`[QQ] Falling back to text-only image placeholder contact=${contactId}`);
  }

  if (!content) {
    return { handled: true as const, reason: "image_without_usable_content" as const };
  }

  // 私聊里的开关命令，命中则直接回执、不进聊天。
  if (kind === "private") {
    const sceneReply = await tryHandleSceneCommand(contactId, content);
    if (sceneReply != null) {
      await sendQqText(contactId, sceneReply);
      return { handled: true as const, reason: "scene_command" as const };
    }
  }

  console.info(`[QQ] Queued message contact=${contactId} messageId=${event.message_id ?? ""}`);
  enqueueSocialTextMessage({
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
