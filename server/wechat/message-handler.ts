import type { WechatyInterface } from "wechaty/impls";
import { handlePersonaChat, handlePersonaMediaChat, type WeChatMediaInput } from "./persona-bridge";
import { recordRecentContact } from "./contact-registry";
import { enqueueWechatTextMessage, type BatchedTextMessage } from "./incoming-message-batcher";
import { sayWeChatReply } from "./reply-sender";

function inferMimeType(fileName: string, kind: WeChatMediaInput["kind"]): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".jpeg") || lower.endsWith(".jpg")) return "image/jpeg";
  return kind === "emoticon" ? "image/jpeg" : "image/jpeg";
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

function isLikelyWechatPlaceholder(
  kind: WeChatMediaInput["kind"],
  imageType: string,
  buffer: Buffer,
  mimeType: string,
): boolean {
  if (kind !== "emoticon") return false;
  if (buffer.byteLength === 0) return false;
  if (imageType !== "slave") return false;
  return buffer.byteLength < 4096 && mimeType === "image/png";
}

function sanitizeFileName(fileName: string, fallback: string): string {
  const safe = fileName
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return safe || fallback;
}

function getFileBoxSourceUrl(fileBox: any): string | undefined {
  const candidates = [
    fileBox?.remoteUrl,
    fileBox?.metadata?.payload?.cdnurl,
    fileBox?.metadata?.payload?.url,
  ];

  try {
    const json = typeof fileBox?.toJSON === "function" ? fileBox.toJSON() : null;
    candidates.push(json?.url);
  } catch {
    // Not all FileBox variants can be serialized. The local buffer path is still usable.
  }

  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const url = candidate.trim();
    if (/^https?:\/\//i.test(url)) return url;
  }

  return undefined;
}

function getWechat4uClient(msg: any): any | null {
  return msg?.wechaty?.puppet?.wechat4u ?? msg?.puppet?.wechat4u ?? null;
}

function getWechatPuppet(msg: any): any | null {
  return msg?.wechaty?.puppet ?? msg?.puppet ?? null;
}

function decodeXmlValue(value: string): string {
  let result = value;
  for (let i = 0; i < 3; i += 1) {
    const next = result
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, "\"")
      .replace(/&apos;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
    if (next === result) break;
    result = next;
  }
  return result;
}

function extractXmlAttribute(xml: string, attribute: string): string | undefined {
  const decodedXml = decodeXmlValue(xml);
  const match = new RegExp(`\\b${attribute}\\s*=\\s*["']([^"']*)["']`, "i").exec(decodedXml);
  const value = match?.[1]?.trim();
  return value ? decodeXmlValue(value) : undefined;
}

function normalizeUrl(url: string, client: any | null): string | undefined {
  const trimmed = decodeXmlValue(url).trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/") && client?.CONF?.origin) {
    return `${client.CONF.origin}${trimmed}`;
  }
  return undefined;
}

function getCandidateUrl(value: unknown, client: any | null): string | undefined {
  return typeof value === "string" ? normalizeUrl(value, client) : undefined;
}

function collectRawPayloadTextFields(rawPayload: any): string[] {
  const directFields = [
    rawPayload?.Content,
    rawPayload?.OriginalContent,
    rawPayload?.OriContent,
    rawPayload?.MMActualContent,
    rawPayload?.MMSendContent,
    rawPayload?.Url,
    rawPayload?.AppMsgUrl,
    rawPayload?.MMAppMsgDownloadUrl,
    rawPayload?.MMPreviewSrc,
    rawPayload?.MMThumbSrc,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  const nestedFields: string[] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 2 || !value || typeof value !== "object") return;
    for (const nestedValue of Object.values(value as Record<string, unknown>)) {
      if (typeof nestedValue === "string" && /url|<|&lt;|http/i.test(nestedValue)) {
        nestedFields.push(nestedValue);
      } else {
        visit(nestedValue, depth + 1);
      }
    }
  };
  visit(rawPayload, 0);

  return Array.from(new Set([...directFields, ...nestedFields]));
}

function extractHttpUrls(text: string, client: any | null): string[] {
  const decodedText = decodeXmlValue(text);
  const matches = decodedText.match(/(?:https?:)?\/\/[^\s"'<>]+|\/cgi-bin\/mmwebwx-bin\/[^\s"'<>]+/gi) ?? [];
  return matches
    .map(url => normalizeUrl(url.replace(/[),.;，。；]+$/g, ""), client))
    .filter((url): url is string => !!url);
}

async function getMessageRawPayload(msg: any): Promise<any | null> {
  const puppet = getWechatPuppet(msg);
  if (!puppet || typeof puppet.messageRawPayload !== "function") return null;

  try {
    return await puppet.messageRawPayload(msg.id);
  } catch (err) {
    console.warn("[WeChat] Failed to read emoticon raw payload:", err);
    return null;
  }
}

function getMessageImageIdCandidates(msg: any, rawPayload: any | null): string[] {
  const values = [
    msg?.id,
    rawPayload?.MsgId,
    rawPayload?.NewMsgId,
    rawPayload?.MsgIdBeforeTranspond,
  ];
  return Array.from(new Set(values
    .map(value => value == null ? "" : String(value).trim())
    .filter(Boolean)));
}

async function readWechat4uMessageImage(
  msg: any,
  kind: WeChatMediaInput["kind"],
  source: string,
): Promise<WeChatMediaInput> {
  const client = getWechat4uClient(msg);
  if (!client || typeof client.getMsgImg !== "function") {
    throw new Error("wechat4u.getMsgImg is not available");
  }

  const rawPayload = await getMessageRawPayload(msg);
  const messageIds = getMessageImageIdCandidates(msg, rawPayload);
  let lastMedia: WeChatMediaInput | null = null;
  let lastErr: unknown = null;

  for (const messageId of messageIds) {
    for (const imageType of ["big", "slave", ""] as const) {
      try {
        const image = imageType
          ? await getWechat4uMessageImageByType(client, messageId, imageType)
          : await client.getMsgImg(messageId);
      const buffer = Buffer.from(image.data ?? []);
      const mimeType = detectImageMimeType(buffer, image.type || inferMimeType(`${messageId}.jpg`, kind));
      const fileName = sanitizeFileName(`message-${messageId}-${kind}${imageExtension(mimeType)}`, `wechat-${kind}${imageExtension(mimeType)}`);
      const placeholder = isLikelyWechatPlaceholder(kind, imageType, buffer, mimeType);

      console.info(
          `[WeChat] Received ${kind} media via ${source}(${messageId === msg.id ? "message-id" : "raw-id"}, type=${imageType || "default"}): ${fileName}, ${mimeType}, ${buffer.byteLength} bytes, sourceUrl=no${placeholder ? ", placeholder=yes" : ""}`,
      );

      if (placeholder) continue;

      if (buffer.byteLength > 0) {
        lastMedia = {
          kind,
          buffer,
          fileName,
          mimeType,
        };
        return lastMedia;
      }
      } catch (err) {
        lastErr = err;
        console.warn(`[WeChat] Failed to extract ${kind} via ${source} id=${messageId} type=${imageType || "default"}:`, err);
      }
    }
  }

  if (lastMedia) return lastMedia;
  throw lastErr ?? new Error("No message image id was available");
}

async function getWechat4uMessageImageByType(
  client: any,
  messageId: string,
  imageType: "big" | "slave",
): Promise<{ data: ArrayBuffer | Buffer; type?: string }> {
  if (!client?.CONF?.API_webwxgetmsgimg || typeof client.request !== "function") {
    return client.getMsgImg(messageId);
  }

  const response = await client.request({
    method: "GET",
    params: {
      MsgID: messageId,
      skey: client.PROP?.skey,
      type: imageType,
    },
    responseType: "arraybuffer",
    url: client.CONF.API_webwxgetmsgimg,
  });

  return {
    data: response.data,
    type: response.headers?.["content-type"],
  };
}

async function downloadUrl(
  url: string,
  client: any | null,
): Promise<{ buffer: Buffer; mimeType?: string }> {
  if (client && typeof client.request === "function") {
    const response = await client.request({
      method: "GET",
      responseType: "arraybuffer",
      url,
    });
    return {
      buffer: Buffer.from(response.data ?? []),
      mimeType: response.headers?.["content-type"],
    };
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    mimeType: response.headers.get("content-type") ?? undefined,
  };
}

async function extractEmoticonFromRawPayload(msg: any): Promise<WeChatMediaInput | null> {
  const rawPayload = await getMessageRawPayload(msg);
  if (!rawPayload) return null;

  const client = getWechat4uClient(msg);
  const rawTextFields = collectRawPayloadTextFields(rawPayload);
  const candidates = [
    getCandidateUrl(rawPayload.MMPreviewSrc, client),
    getCandidateUrl(rawPayload.MMThumbSrc, client),
    getCandidateUrl(rawPayload.MMAppMsgDownloadUrl, client),
    ...rawTextFields.flatMap(text => [
      getCandidateUrl(extractXmlAttribute(text, "cdnurl"), client),
      getCandidateUrl(extractXmlAttribute(text, "cdnUrl"), client),
      getCandidateUrl(extractXmlAttribute(text, "thumburl"), client),
      getCandidateUrl(extractXmlAttribute(text, "thumbUrl"), client),
      getCandidateUrl(extractXmlAttribute(text, "encrypturl"), client),
      getCandidateUrl(extractXmlAttribute(text, "encryptUrl"), client),
      getCandidateUrl(extractXmlAttribute(text, "url"), client),
      ...extractHttpUrls(text, client),
    ]),
  ].filter((url): url is string => !!url);

  const uniqueUrls = Array.from(new Set(candidates));
  console.info(`[WeChat] Emoticon raw payload image URL candidates: ${uniqueUrls.length}`);

  for (let index = 0; index < uniqueUrls.length; index += 1) {
    const url = uniqueUrls[index];
    try {
      const { buffer, mimeType } = await downloadUrl(url, client);
      const resolvedMime = detectImageMimeType(buffer, mimeType || inferMimeType(url, "emoticon"));
      const fileName = sanitizeFileName(`message-${msg.id}-emoticon-${index + 1}${imageExtension(resolvedMime)}`, `wechat-emoticon${imageExtension(resolvedMime)}`);
      console.info(
        `[WeChat] Received emoticon media via raw-payload-url-${index + 1}: ${fileName}, ${resolvedMime}, ${buffer.byteLength} bytes, sourceUrl=yes`,
      );
      if (buffer.byteLength > 0) {
        return {
          kind: "emoticon",
          buffer,
          fileName,
          mimeType: resolvedMime,
          sourceUrl: url,
        };
      }
    } catch (err) {
      console.warn(`[WeChat] Failed to download emoticon raw payload URL ${index + 1}:`, err);
    }
  }

  return null;
}

async function readFileBox(
  fileBox: any,
  kind: WeChatMediaInput["kind"],
  source: string,
): Promise<WeChatMediaInput> {
  const fallback = `wechat-${kind}.jpg`;
  const fileName = sanitizeFileName(fileBox.name || fallback, fallback);
  const sourceUrl = getFileBoxSourceUrl(fileBox);

  let buffer = Buffer.alloc(0);
  try {
    buffer = Buffer.from(await fileBox.toBuffer());
  } catch (err) {
    if (!sourceUrl) throw err;
    console.warn(`[WeChat] ${kind} ${source} download failed, will try source URL for vision.`);
  }

  const mimeType = detectImageMimeType(buffer, fileBox.mediaType || fileBox.mimeType || inferMimeType(fileName, kind));
  const normalizedFileName = fileName.replace(/\.(?:jpg|jpeg|png|gif|webp)$/i, imageExtension(mimeType));

  console.info(
    `[WeChat] Received ${kind} media via ${source}: ${normalizedFileName}, ${mimeType}, ${buffer.byteLength} bytes, sourceUrl=${sourceUrl ? "yes" : "no"}`,
  );

  return {
    kind,
    buffer,
    fileName: normalizedFileName,
    mimeType,
    sourceUrl,
  };
}

async function extractImageMessage(msg: any): Promise<WeChatMediaInput> {
  try {
    const media = await readWechat4uMessageImage(msg, "image", "wechat4u.getMsgImg");
    if (media.buffer.byteLength > 0) return media;
  } catch (err) {
    console.warn("[WeChat] Failed to extract image via wechat4u.getMsgImg, will try toFileBox:", err);
  }

  const media = await readFileBox(await msg.toFileBox(), "image", "message.toFileBox");
  if (media.buffer.byteLength > 0 || media.sourceUrl) return media;

  throw new Error("No usable image data was available");
}

async function extractEmoticonMessage(msg: any): Promise<WeChatMediaInput> {
  try {
    const media = await readWechat4uMessageImage(msg, "emoticon", "wechat4u.getMsgImg");
    if (media.buffer.byteLength > 0) return media;
  } catch (err) {
    console.warn("[WeChat] Failed to extract emoticon via wechat4u.getMsgImg, will try raw payload:", err);
  }

  const rawPayloadMedia = await extractEmoticonFromRawPayload(msg);
  if (rawPayloadMedia) return rawPayloadMedia;

  try {
    const media = await readFileBox(await msg.toFileBox(), "emoticon", "message.toFileBox");
    if (media.buffer.byteLength === 0 && !media.sourceUrl) {
      console.warn("[WeChat] Emoticon payload is empty; replying without visual understanding.");
    }
    return media;
  } catch (err) {
    console.warn("[WeChat] Failed to extract emoticon via toFileBox:", err);
    return {
      kind: "emoticon",
      buffer: Buffer.alloc(0),
      fileName: "wechat-emoticon.jpg",
      mimeType: "image/jpeg",
    };
  }
}

async function extractMediaMessage(msg: any, kind: WeChatMediaInput["kind"]): Promise<WeChatMediaInput> {
  if (kind === "image") return extractImageMessage(msg);
  return extractEmoticonMessage(msg);
}

export async function handleWeChatMessage(msg: any, bot: WechatyInterface) {
  const contact = msg.talker();
  if (contact.self()) return;

  const room = msg.room();
  if (room) return; // only handle private messages for persona chat

  const contactId = contact.id;
  const contactName = await contact.name();
  const type = msg.type();

  if (type === bot.Message.Type.Text) {
    const content = msg.text().trim();
    if (!content) return;

    recordRecentContact({ id: contactId, name: contactName, messageText: content });

    enqueueWechatTextMessage({
      contact,
      contactId,
      contactName,
      text: content,
      onBatch: handleTextBatch,
    });
    return;
  }

  if (type === bot.Message.Type.Image || type === bot.Message.Type.Emoticon) {
    const kind = type === bot.Message.Type.Emoticon ? "emoticon" : "image";
    const preview = kind === "emoticon" ? "[表情包]" : "[图片]";

    recordRecentContact({ id: contactId, name: contactName, messageText: preview });

    let media: WeChatMediaInput;
    try {
      media = await extractMediaMessage(msg, kind);
    } catch (err) {
      console.warn(`[WeChat] Failed to download ${kind} message, falling back to text-only:`, err);
      const reply = await handlePersonaChat(contactId, contactName, preview);
      if (reply) {
        await sayWeChatReply(contact, reply);
      }
      return;
    }

    const reply = await handlePersonaMediaChat(contactId, contactName, media);
    if (reply) {
      await sayWeChatReply(contact, reply);
    }
  }
}

async function handleTextBatch(batch: BatchedTextMessage): Promise<void> {
  const reply = await handlePersonaChat(batch.contactId, batch.contactName, batch.combinedText, {
    batchMessageCount: batch.messageCount,
    batchMessages: batch.messages,
  });
  if (reply) {
    await sayWeChatReply(batch.contact, reply);
  }
}
