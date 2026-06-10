import path from "path";
import { ENV } from "../_core/env";
import { recordOperationsEvent } from "../_core/operations-events";

export type ZhipuAsrSuccess = {
  ok: true;
  transcript: string;
  model: string;
  requestId?: string;
};

export type ZhipuAsrFailure = {
  ok: false;
  status: "asr_not_configured" | "asr_request_failed" | "asr_empty_transcript";
  reason: string;
  model: string;
};

export type ZhipuAsrResult = ZhipuAsrSuccess | ZhipuAsrFailure;

type ZhipuAsrOptions = {
  buffer: Buffer;
  fileName: string;
  mimeType?: string;
  prompt?: string;
  hotwords?: string[];
  userId?: string;
};

function zhipuBaseUrl(): string {
  return ENV.zhipuBaseUrl.replace(/\/+$/, "");
}

function mimeForAudioFile(fileName: string, fallback = "audio/mpeg"): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  if (lower.endsWith(".ogg")) return "audio/ogg";
  if (lower.endsWith(".flac")) return "audio/flac";
  return fallback;
}

export function extractZhipuAsrTranscript(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const data = body as Record<string, any>;

  if (typeof data.text === "string") return data.text.trim();

  const choices = Array.isArray(data.choices) ? data.choices : [];
  for (const choice of choices) {
    const content = choice?.message?.content;
    if (typeof content === "string" && content.trim()) return content.trim();
  }

  return "";
}

export async function transcribeWithZhipuAsr(options: ZhipuAsrOptions): Promise<ZhipuAsrResult> {
  const model = ENV.zhipuAsrModel;
  if (!ENV.zhipuApiKey) {
    recordOperationsEvent({
      id: "voice.asr_not_configured",
      scope: "voice",
      title: "ASR 未配置",
      detail: "智谱 ASR 没有可用 API key，QQ 语音输入无法转写。",
      evidence: "ZHIPU_API_KEY/BIGMODEL_API_KEY/VISION_API_KEY 未配置",
    });
    return {
      ok: false,
      status: "asr_not_configured",
      reason: "ZHIPU_API_KEY/BIGMODEL_API_KEY/VISION_API_KEY is not configured",
      model,
    };
  }

  try {
    const form = new FormData();
    const safeName = path.basename(options.fileName) || "voice.mp3";
    const mimeType = options.mimeType || mimeForAudioFile(safeName);
    form.append("model", model);
    form.append("stream", "false");
    form.append("file", new Blob([new Uint8Array(options.buffer)], { type: mimeType }), safeName);
    if (options.prompt?.trim()) form.append("prompt", options.prompt.trim());
    if (options.hotwords?.length) {
      for (const word of options.hotwords.slice(0, 100)) {
        if (word.trim()) form.append("hotwords", word.trim());
      }
    }
    if (options.userId?.trim()) form.append("user_id", options.userId.trim());

    console.info(`voice_asr_start provider=zhipu model=${model} bytes=${options.buffer.byteLength}`);
    const response = await fetch(`${zhipuBaseUrl()}/audio/transcriptions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${ENV.zhipuApiKey}`,
      },
      body: form,
    });

    const responseText = await response.text();
    if (!response.ok) {
      console.warn(`voice_asr_failed provider=zhipu status=${response.status} body=${responseText.slice(0, 300)}`);
      recordOperationsEvent({
        id: "voice.asr_request_failed",
        scope: "voice",
        title: "ASR 请求失败",
        detail: "智谱 ASR 接口返回错误，QQ 语音输入会降级到文字提示。",
        rawError: `HTTP ${response.status}: ${responseText.slice(0, 300)}`,
        evidence: `provider=zhipu model=${model}`,
      });
      return {
        ok: false,
        status: "asr_request_failed",
        reason: `HTTP ${response.status}`,
        model,
      };
    }

    const body = responseText ? JSON.parse(responseText) : {};
    const transcript = extractZhipuAsrTranscript(body);
    if (!transcript) {
      console.warn("voice_asr_empty_transcript provider=zhipu");
      recordOperationsEvent({
        id: "voice.asr_empty_transcript",
        scope: "voice",
        title: "ASR 返回空文本",
        detail: "语音识别请求成功但没有识别出文本，当前回合会降级到文字提示。",
        evidence: `provider=zhipu model=${model}`,
      });
      return {
        ok: false,
        status: "asr_empty_transcript",
        reason: "ASR returned an empty transcript",
        model,
      };
    }

    console.info(`voice_asr_success provider=zhipu chars=${Array.from(transcript).length}`);
    return {
      ok: true,
      transcript,
      model,
      requestId: typeof body.request_id === "string" ? body.request_id : undefined,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn("voice_asr_failed provider=zhipu", reason);
    recordOperationsEvent({
      id: "voice.asr_request_failed",
      scope: "voice",
      title: "ASR 请求失败",
      detail: "智谱 ASR 请求抛出异常，QQ 语音输入会降级到文字提示。",
      rawError: reason,
      evidence: `provider=zhipu model=${model}`,
    });
    return {
      ok: false,
      status: "asr_request_failed",
      reason,
      model,
    };
  }
}
