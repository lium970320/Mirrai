import { ENV } from "./_core/env";

export type VisionImageInput = {
  kind: "image" | "emoticon";
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  sourceUrl?: string;
};

type PreparedVisionImage = {
  buffer: Buffer;
  mimeType: string;
};

function buildVisionPrompt(input: VisionImageInput): string {
  const label = input.kind === "emoticon" ? "表情包" : "图片";
  return [
    `请理解这张${label}，输出给后续聊天模型使用的中文描述。`,
    "要求：",
    "1. 描述画面主体、场景、动作和可见文字。",
    "2. 如果是表情包，重点判断它的情绪、玩笑意味、潜台词或聊天意图。",
    "3. 如果画面是 2x2 拼图，请按左上、右上、左下、右下的顺序理解它是动图关键帧，不要把它误判成四张无关图片。",
    "4. 不确定的细节请说不确定，不要编造。",
    "5. 不要直接代替角色回复，只输出图片理解结果。",
    "6. 控制在 120 字以内。",
  ].join("\n");
}

function cleanDescription(text: string): string {
  return text
    .replace(/^```(?:json|markdown|text)?/i, "")
    .replace(/```$/i, "")
    .trim()
    .slice(0, 800);
}

export function isVisionConfigured(): boolean {
  return !!ENV.visionApiKey && !!ENV.visionBaseUrl && !!ENV.visionModel;
}

function usesRawBase64ImageUrl(baseUrl: string, model: string): boolean {
  return /bigmodel\.cn/i.test(baseUrl) || /^glm-/i.test(model);
}

function uniqueFrameIndexes(frameCount: number, targetCount = 4): number[] {
  if (frameCount <= 0) return [];
  if (frameCount === 1) return [0];

  const indexes: number[] = [];
  for (let i = 0; i < targetCount; i += 1) {
    const index = Math.round((i * (frameCount - 1)) / (targetCount - 1));
    if (!indexes.includes(index)) indexes.push(index);
  }
  return indexes;
}

function detectImageMimeType(buffer: Buffer, fallback: string): string {
  if (buffer.byteLength >= 6 && buffer.subarray(0, 6).toString("ascii").startsWith("GIF8")) {
    return "image/gif";
  }
  if (buffer.byteLength >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (buffer.byteLength >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.byteLength >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  return fallback;
}

async function gifToKeyframeGridPng(buffer: Buffer): Promise<Buffer | null> {
  const jimpModule = await import("jimp");
  const Jimp = (jimpModule.default ?? jimpModule) as any;
  const gifwrapModule = await import("gifwrap");
  const { GifUtil } = (gifwrapModule.default ?? gifwrapModule) as any;

  const gif = await GifUtil.read(buffer);
  const frames = Array.isArray(gif.frames) ? gif.frames : [];
  if (frames.length === 0) return null;

  const { maxWidth, maxHeight } = GifUtil.getMaxDimensions(frames);
  const cellWidth = Math.max(maxWidth || frames[0].bitmap.width, 1);
  const cellHeight = Math.max(maxHeight || frames[0].bitmap.height, 1);
  const gap = Math.max(4, Math.round(Math.min(cellWidth, cellHeight) * 0.03));
  const canvas = new Jimp(cellWidth * 2 + gap, cellHeight * 2 + gap, 0xffffffff);
  const indexes = uniqueFrameIndexes(frames.length);

  for (let cell = 0; cell < 4; cell += 1) {
    const frameIndex = indexes[Math.min(cell, indexes.length - 1)];
    const frame = frames[frameIndex];
    const frameImage = GifUtil.copyAsJimp(Jimp, frame);
    const x = (cell % 2) * (cellWidth + gap) + Math.max(0, frame.xOffset ?? 0);
    const y = Math.floor(cell / 2) * (cellHeight + gap) + Math.max(0, frame.yOffset ?? 0);
    canvas.composite(frameImage, x, y);
  }

  return canvas.getBufferAsync(Jimp.MIME_PNG);
}

async function gifToFirstFramePng(buffer: Buffer): Promise<Buffer | null> {
  const jimpModule = await import("jimp");
  const Jimp = (jimpModule.default ?? jimpModule) as any;
  const image = await Jimp.read(buffer);
  return image.getBufferAsync(Jimp.MIME_PNG);
}

async function prepareVisionImage(input: VisionImageInput): Promise<PreparedVisionImage | null> {
  if (input.buffer.byteLength === 0) return null;

  const detectedMimeType = detectImageMimeType(input.buffer, input.mimeType);
  if (detectedMimeType !== "image/gif") {
    return {
      buffer: input.buffer,
      mimeType: detectedMimeType,
    };
  }

  try {
    const pngBuffer = await gifToKeyframeGridPng(input.buffer) ?? await gifToFirstFramePng(input.buffer);
    if (!pngBuffer) return null;
    return {
      buffer: pngBuffer,
      mimeType: "image/png",
    };
  } catch (err) {
    console.warn("[Vision] Failed to convert GIF keyframes to PNG:", err);
    return null;
  }
}

export async function describeImage(input: VisionImageInput): Promise<string | null> {
  if (!isVisionConfigured()) return null;
  if (!input.mimeType.startsWith("image/")) return null;

  const prepared = input.buffer.byteLength > 0 ? await prepareVisionImage(input) : null;
  const sourceUrl = prepared ? undefined : input.sourceUrl?.trim();
  if (!sourceUrl && !prepared) return null;
  if (prepared && prepared.buffer.byteLength > ENV.visionMaxInlineBytes) return null;

  const baseUrl = ENV.visionBaseUrl.replace(/\/+$/, "");
  const imageBase64 = sourceUrl ? null : prepared?.buffer.toString("base64");
  const imageUrl = sourceUrl
    ?? (usesRawBase64ImageUrl(baseUrl, ENV.visionModel)
      ? imageBase64
      : `data:${prepared?.mimeType};base64,${imageBase64}`);

  if (!imageUrl) return null;

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ENV.visionApiKey}`,
    },
    body: JSON.stringify({
      model: ENV.visionModel,
      messages: [
        {
          role: "system",
          content: "你是一个聊天图片和表情包理解器。你的输出会提供给另一个角色扮演聊天模型。",
        },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: imageUrl } },
            { type: "text", text: buildVisionPrompt(input) },
          ],
        },
      ],
      temperature: 0.2,
      max_tokens: 500,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`[Vision] ${ENV.visionModel} error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string") return null;

  const description = cleanDescription(content);
  return description || null;
}
