import { createHash } from "crypto";
import { spawn } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { mkdtemp, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { ENV } from "./env";
import {
  selectVoxcpmVoiceProfile,
  type SelectedVoxcpmVoiceProfile,
} from "../voice/voxcpm-voice-profile";

const UPLOAD_DIR = ENV.uploadDir || "./uploads";
const TTS_DIR = path.resolve(UPLOAD_DIR, "tts");
const DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural";
const MAX_TEXT_LENGTH = 500;
const VOXCPM_CACHE_VERSION = "voxcpm-performance-v4";
const MINIMAX_CACHE_VERSION = "minimax-t2a-v1";
type TTSProvider = "edge" | "windows-sapi" | "voxcpm" | "minimax" | "auto" | "none";
type MiniMaxAudioFormat = "mp3" | "wav" | "flac";
type MiniMaxResponseFormat = "hex" | "url";
type TTSResult = {
  filePath: string;
  urlPath: string;
  voice: string;
  provider: "edge" | "windows-sapi" | "voxcpm" | "minimax";
  format: "mp3" | "wav" | "flac";
};

type VoxcpmSpeechPerformance = {
  speechText: string;
  control: string;
  source: "local" | "llm";
  voiceProfile: SelectedVoxcpmVoiceProfile;
};

function getCacheKey(text: string, voice: string, provider: string): string {
  return createHash("sha256").update(text + voice + provider).digest("hex").slice(0, 16);
}

export async function generateTTS(
  text: string,
  voice: string = DEFAULT_VOICE,
): Promise<string> {
  const result = await generateTTSFile(text, voice);
  return result.urlPath;
}

export async function generateTTSFile(
  text: string,
  voice: string = DEFAULT_VOICE,
  provider: TTSProvider = normalizeProvider(ENV.ttsProvider),
): Promise<TTSResult> {
  const trimmed = text.slice(0, MAX_TEXT_LENGTH);
  if (provider === "none") {
    throw new Error("TTS provider is disabled");
  }
  if (provider === "windows-sapi") {
    return generateWindowsSapiTTSFile(trimmed, voice);
  }
  if (provider === "voxcpm") {
    try {
      return await generateVoxcpmTTSFile(trimmed, voice);
    } catch (err) {
      console.warn(`tts_voxcpm_failed fallback=${ENV.ttsFallbackProvider}`, err);
      return generateTTSFile(trimmed, voice, fallbackProviderFor("voxcpm"));
    }
  }
  if (provider === "minimax") {
    try {
      return await generateMinimaxTTSFile(trimmed, voice);
    } catch (err) {
      console.warn(`tts_minimax_failed fallback=${ENV.ttsFallbackProvider}`, err);
      return generateTTSFile(trimmed, voice, fallbackProviderFor("minimax"));
    }
  }

  try {
    return await generateEdgeTTSFile(trimmed, voice);
  } catch (err) {
    console.warn("tts_edge_failed fallback=windows-sapi", err);
    if (process.platform !== "win32") throw err;
    return generateWindowsSapiTTSFile(trimmed, voice);
  }
}

function normalizeProvider(provider: string): TTSProvider {
  const normalized = provider.trim().toLowerCase();
  if (normalized === "none" || normalized === "off" || normalized === "false" || normalized === "disabled") {
    return "none";
  }
  if (
    normalized === "edge"
    || normalized === "windows-sapi"
    || normalized === "voxcpm"
    || normalized === "minimax"
    || normalized === "auto"
  ) return normalized;
  return "auto";
}

function fallbackProviderFor(failedProvider: TTSProvider): TTSProvider {
  const fallbackProvider = normalizeProvider(ENV.ttsFallbackProvider);
  if (fallbackProvider === "none") return "none";
  if (fallbackProvider !== failedProvider && fallbackProvider !== "auto") return fallbackProvider;
  if (process.platform === "win32" && failedProvider !== "windows-sapi") return "windows-sapi";
  return failedProvider === "edge" ? "windows-sapi" : "edge";
}

export function humanizeVoxcpmSpeechText(text: string): string {
  let speech = text
    .replace(/\s+/g, " ")
    .replace(/聊会(?!儿)/g, "聊会儿")
    .replace(/今天累不累[。.!！?？]?/g, "你今天，累不累？")
    .replace(/(^|[^，,])累不累[。.!！?？]?/g, "$1累不累？")
    .replace(/好不好[。.]?/g, "好不好？")
    .replace(/行不行[。.]?/g, "行不行？")
    .replace(/是不是[。.]?/g, "是不是？")
    .replace(/在不在[。.]?/g, "在不在？")
    .trim();

  speech = speech.replace(/^那我/, "那……我");
  speech = speech.replace(/聊会儿[，,]\s*你今天/g, "聊会儿。你今天");
  speech = speech.replace(/^嗯[,，]?\s*/, "嗯……");
  speech = speech.replace(/^好[,，]?\s*/, "好。");

  speech = speech.replace(/([，,])([^，。！？!?；;、]{2,9})([。.!！?？])/g, (_match, _comma, phrase, end) => {
    if (/^(今天|晚上|明天|现在|一会儿|待会儿)/.test(phrase)) {
      return `。${phrase}${end}`;
    }
    return `，${phrase}${end}`;
  });

  speech = speech.replace(/([。！？!?])\s*/g, "$1 ");
  speech = speech.replace(/\s+/g, " ").trim();
  return speech || text;
}

function normalizeVoxcpmSpeechEnrichmentMode(value: string): "off" | "local" | "llm" {
  const mode = value.trim().toLowerCase();
  if (mode === "false" || mode === "0" || mode === "none" || mode === "off") return "off";
  if (mode === "llm" || mode === "model" || mode === "ai") return "llm";
  return "local";
}

function sanitizeVoxcpmSpeechText(text: string, fallback: string): string {
  const cleaned = text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[（(][^（）()]{1,40}[）)]/g, "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return fallback;
  if (Array.from(cleaned).length > MAX_TEXT_LENGTH) return fallback;
  return cleaned;
}

function sanitizeVoxcpmControl(text: string): string {
  return text
    .replace(/[()（）]/g, "")
    .replace(/[\r\n]+/g, "；")
    .replace(/\s+/g, " ")
    .replace(/[;；]{2,}/g, "；")
    .trim()
    .slice(0, 180);
}

function inferVoxcpmEmotionControl(text: string): string {
  const compact = text.replace(/\s+/g, "");
  if (/陪|聊会|累不累|困|睡|晚安|别怕|抱|想你|心疼|难受|委屈/.test(compact)) {
    return "语气放低一点，柔和，句间留停顿";
  }
  if (/哈哈|笑|逗|笨|傻|闹/.test(compact)) {
    return "带很轻的笑意，不夸张";
  }
  if (/生气|烦|算了|随便|不管|别说/.test(compact)) {
    return "克制提醒，不吼";
  }
  if (/累不累|好不好|行不行|是不是|可以吗|吗[？?]?|[？?]/.test(compact)) {
    return "疑问句自然，不机械";
  }
  return "";
}

function mergeVoxcpmControl(baseControl: string, extraControl: string): string {
  const base = sanitizeVoxcpmControl(baseControl);
  const extra = sanitizeVoxcpmControl(extraControl);
  return [base, extra].filter(Boolean).join("；");
}

export function buildLocalVoxcpmSpeechPerformance(
  text: string,
  baseControl = ENV.voxcpmControl,
  voiceProfile: SelectedVoxcpmVoiceProfile = selectVoxcpmVoiceProfile({ text }),
): VoxcpmSpeechPerformance {
  const speechText = humanizeVoxcpmSpeechText(text);
  const control = mergeVoxcpmControl(
    baseControl,
    [
      "自然微信语音，按语义停顿，不要朗读腔",
      inferVoxcpmEmotionControl(speechText),
    ].join("；"),
  );
  return { speechText, control, source: "local", voiceProfile };
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || text.match(/\{[\s\S]*\}/)?.[0] || "";
  if (!candidate.trim()) return null;
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

async function buildLlmVoxcpmSpeechPerformance(
  originalText: string,
  localPerformance: VoxcpmSpeechPerformance,
): Promise<VoxcpmSpeechPerformance> {
  const { llmService } = await import("../llm");
  const response = await llmService.invoke({
    messages: [
      {
        role: "system",
        content: [
          "你是中文微信语音的表演稿导演，只为 TTS 改写语音稿。",
          "目标：让角色说话更像真人，有情绪、有停顿、有轻重音，但不要改变事实含义。",
          "只返回 JSON，不要解释。",
          "JSON 格式：{\"speechText\":\"...\",\"control\":\"...\"}",
          "speechText 只能是会被读出来的台词，可以加入省略号、逗号、句号、问号来制造停顿；不要写括号动作、旁白、情绪标签。",
          "control 写给 TTS 的表演提示，描述每一句的语气、情绪和停顿；不要超过 120 个汉字。",
          "不要把用户没有说的内容加进去，不要增加新事实，不要把一句短回复扩成长回复。",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `原始回复：${originalText}`,
          `本地基础语音稿：${localPerformance.speechText}`,
          "请输出更适合 VoxCPM 朗读的一版。",
        ].join("\n"),
      },
    ],
    options: {
      provider: ENV.voxcpmSpeechEnrichmentProvider || undefined,
      maxTokens: 260,
      temperature: 0.25,
    },
  });
  const parsed = extractJsonObject(response);
  if (!parsed) throw new Error("LLM speech enrichment returned non-JSON output");

  const rawSpeech = typeof parsed.speechText === "string" ? parsed.speechText : "";
  const rawControl = typeof parsed.control === "string" ? parsed.control : "";
  const speechText = sanitizeVoxcpmSpeechText(rawSpeech, localPerformance.speechText);
  const control = mergeVoxcpmControl(localPerformance.control, rawControl);
  return { speechText, control, source: "llm", voiceProfile: localPerformance.voiceProfile };
}

async function prepareVoxcpmSpeechPerformance(text: string): Promise<VoxcpmSpeechPerformance> {
  const voiceProfile = selectVoxcpmVoiceProfile({ text, fileExists: existsSync });
  if (voiceProfile.fallbackReferenceProfileId) {
    console.info(
      `voxcpm_voice_profile_fallback requested=${voiceProfile.requestedProfileId} reference=${voiceProfile.fallbackReferenceProfileId} reason=${voiceProfile.fallbackReason ?? ""}`,
    );
  } else if (voiceProfile.fallbackReason) {
    console.info(`voxcpm_voice_profile_fallback requested=${voiceProfile.requestedProfileId} reason=${voiceProfile.fallbackReason}`);
  }
  console.info(
    `voxcpm_voice_profile_selected id=${voiceProfile.profile.id} requested=${voiceProfile.requestedProfileId} label=${voiceProfile.profile.label}`,
  );
  const localPerformance = buildLocalVoxcpmSpeechPerformance(text, voiceProfile.profile.control, voiceProfile);
  const mode = normalizeVoxcpmSpeechEnrichmentMode(ENV.voxcpmSpeechEnrichment);
  if (mode === "off") {
    return {
      speechText: humanizeVoxcpmSpeechText(text),
      control: voiceProfile.profile.control,
      source: "local",
      voiceProfile,
    };
  }
  if (mode !== "llm") return localPerformance;

  try {
    const enriched = await buildLlmVoxcpmSpeechPerformance(text, localPerformance);
    console.info(`tts_voxcpm_speech_enriched source=${enriched.source}`);
    return enriched;
  } catch (err) {
    console.warn("tts_voxcpm_speech_enrichment_failed fallback=local", err);
    return localPerformance;
  }
}

export function humanizeMinimaxSpeechText(text: string): string {
  let speech = text
    .replace(/\s+/g, " ")
    .replace(/聊会(?!儿)/g, "聊会儿")
    .replace(/今天累不累[。.!！?？]?/g, "你今天，累不累？")
    .replace(/好不好[。.]?/g, "好不好？")
    .replace(/行不行[。.]?/g, "行不行？")
    .replace(/是不是[。.]?/g, "是不是？")
    .replace(/在不在[。.]?/g, "在不在？")
    .trim();

  speech = speech.replace(/^嗯[,，]?\s*/, "嗯，");
  speech = speech.replace(/^好[,，]?\s*/, "好。");
  speech = speech.replace(/([。！？!?])\s*/g, "$1 ");
  speech = speech.replace(/([，,])\s*/g, "$1");
  speech = speech.replace(/\s+/g, " ").trim();

  return speech || text;
}

async function generateEdgeTTSFile(
  text: string,
  voice: string,
): Promise<TTSResult> {
  const hash = getCacheKey(text, voice, "edge");
  const fileName = `${hash}.mp3`;
  const filePath = path.join(TTS_DIR, fileName);
  const urlPath = `/uploads/tts/${fileName}`;

  if (existsSync(filePath)) return { filePath, urlPath, voice, provider: "edge", format: "mp3" };

  if (!existsSync(TTS_DIR)) mkdirSync(TTS_DIR, { recursive: true });

  const { tts } = await import("edge-tts");
  const audioBuffer = await tts(text, { voice });
  await writeFile(filePath, audioBuffer);

  return { filePath, urlPath, voice, provider: "edge", format: "mp3" };
}

function voxcpmCacheKey(
  text: string,
  voice: string,
  control: string,
  voiceProfile: SelectedVoxcpmVoiceProfile,
): string {
  return [
    VOXCPM_CACHE_VERSION,
    text,
    voice,
    control,
    voiceProfile.profile.id,
    voiceProfile.requestedProfileId,
    voiceProfile.fallbackReferenceProfileId ?? "",
    ENV.voxcpmCloneMode,
    voiceProfile.profile.referenceAudioPath,
    voiceProfile.profile.promptText,
    String(ENV.voxcpmCfgValue),
    String(ENV.voxcpmInferenceSteps),
    String(ENV.voxcpmNormalize),
    String(ENV.voxcpmDenoise),
  ].join("\n");
}

async function generateVoxcpmTTSFile(text: string, voice: string): Promise<TTSResult> {
  const startedAt = Date.now();
  const performance = await prepareVoxcpmSpeechPerformance(text);
  const preparedAt = Date.now();
  const hash = getCacheKey(
    voxcpmCacheKey(performance.speechText, voice, performance.control, performance.voiceProfile),
    "voxcpm",
    "voxcpm",
  );
  const fileName = `${hash}.wav`;
  const filePath = path.join(TTS_DIR, fileName);
  const urlPath = `/uploads/tts/${fileName}`;

  if (existsSync(filePath)) {
    console.info(
      `tts_voxcpm_cache_hit chars=${Array.from(performance.speechText).length} profile=${performance.voiceProfile.profile.id} prepareMs=${preparedAt - startedAt}`,
    );
    return { filePath, urlPath, voice, provider: "voxcpm", format: "wav" };
  }
  if (!existsSync(TTS_DIR)) mkdirSync(TTS_DIR, { recursive: true });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ENV.voxcpmTimeoutMs);
  try {
    console.info(
      `tts_voxcpm_request_start chars=${Array.from(performance.speechText).length} profile=${performance.voiceProfile.profile.id} prepareMs=${preparedAt - startedAt} timeoutMs=${ENV.voxcpmTimeoutMs}`,
    );
    const response = await fetch(`${ENV.voxcpmServiceUrl.replace(/\/+$/, "")}/tts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: performance.speechText,
        outputPath: filePath,
        control: performance.control,
        cloneMode: ENV.voxcpmCloneMode,
        referenceAudioPath: performance.voiceProfile.profile.referenceAudioPath || null,
        promptText: performance.voiceProfile.profile.promptText || null,
        cfgValue: ENV.voxcpmCfgValue,
        inferenceTimesteps: ENV.voxcpmInferenceSteps,
        normalize: ENV.voxcpmNormalize,
        denoise: ENV.voxcpmDenoise,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`VoxCPM HTTP ${response.status}: ${body.slice(0, 500)}`);
    }
    const body = await response.json().catch(() => ({})) as { ok?: boolean; error?: string };
    if (!body.ok) {
      throw new Error(body.error || "VoxCPM service returned an unsuccessful response");
    }
    if (!existsSync(filePath)) {
      throw new Error("VoxCPM service did not create an audio file");
    }
    console.info(`tts_voxcpm_request_success elapsedMs=${Date.now() - preparedAt} totalMs=${Date.now() - startedAt}`);
    return { filePath, urlPath, voice, provider: "voxcpm", format: "wav" };
  } catch (err) {
    console.warn(`tts_voxcpm_request_failed elapsedMs=${Date.now() - preparedAt} totalMs=${Date.now() - startedAt}`, err);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeMiniMaxAudioFormat(format: string): MiniMaxAudioFormat {
  if (format === "wav" || format === "flac") return format;
  return "mp3";
}

function normalizeMiniMaxResponseFormat(format: string): MiniMaxResponseFormat {
  return format === "url" ? "url" : "hex";
}

function resolveMiniMaxVoiceId(voice: string): string {
  const trimmed = voice.trim();
  if (trimmed && trimmed !== DEFAULT_VOICE && !trimmed.startsWith("zh-CN-")) return trimmed;
  return ENV.minimaxVoiceId || "male-qn-qingse";
}

function minimaxEndpoint(): string {
  const baseUrl = ENV.minimaxBaseUrl.replace(/\/+$/, "");
  const url = new URL(`${baseUrl}/t2a_v2`);
  if (ENV.minimaxGroupId) {
    url.searchParams.set("GroupId", ENV.minimaxGroupId);
  }
  return url.toString();
}

function minimaxCacheKey(text: string, voiceId: string): string {
  return [
    MINIMAX_CACHE_VERSION,
    text,
    voiceId,
    ENV.minimaxBaseUrl,
    ENV.minimaxGroupId,
    ENV.minimaxModel,
    ENV.minimaxLanguageBoost,
    normalizeMiniMaxAudioFormat(ENV.minimaxAudioFormat),
    normalizeMiniMaxResponseFormat(ENV.minimaxResponseFormat),
    String(ENV.minimaxSampleRate),
    String(ENV.minimaxBitrate),
    String(ENV.minimaxChannel),
    String(ENV.minimaxSpeed),
    String(ENV.minimaxVolume),
    String(ENV.minimaxPitch),
    ENV.minimaxEmotion,
    String(ENV.minimaxTextHumanize),
  ].join("\n");
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== ""),
  ) as T;
}

function decodeMiniMaxAudio(audio: string): Buffer {
  const compact = audio.trim();
  if (!compact) throw new Error("MiniMax response did not include audio data");
  if (/^[0-9a-f]+$/i.test(compact) && compact.length % 2 === 0) {
    return Buffer.from(compact, "hex");
  }
  return Buffer.from(compact, "base64");
}

async function downloadMiniMaxAudio(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`MiniMax audio URL HTTP ${response.status}: ${body.slice(0, 500)}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

type MiniMaxTTSResponse = {
  data?: {
    audio?: string;
    status?: number;
  } | null;
  trace_id?: string;
  base_resp?: {
    status_code?: number;
    status_msg?: string;
  };
};

async function generateMinimaxTTSFile(text: string, voice: string): Promise<TTSResult> {
  if (!ENV.minimaxApiKey) {
    throw new Error("MINIMAX_API_KEY is required when QQ_TTS_PROVIDER=minimax");
  }

  const voiceId = resolveMiniMaxVoiceId(voice);
  const speechText = ENV.minimaxTextHumanize ? humanizeMinimaxSpeechText(text) : text;
  const audioFormat = normalizeMiniMaxAudioFormat(ENV.minimaxAudioFormat);
  const responseFormat = normalizeMiniMaxResponseFormat(ENV.minimaxResponseFormat);
  const hash = getCacheKey(minimaxCacheKey(speechText, voiceId), "minimax", "minimax");
  const fileName = `${hash}.${audioFormat}`;
  const filePath = path.join(TTS_DIR, fileName);
  const urlPath = `/uploads/tts/${fileName}`;

  if (existsSync(filePath)) return { filePath, urlPath, voice: voiceId, provider: "minimax", format: audioFormat };
  if (!existsSync(TTS_DIR)) mkdirSync(TTS_DIR, { recursive: true });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ENV.minimaxTimeoutMs);
  try {
    const response = await fetch(minimaxEndpoint(), {
      method: "POST",
      headers: {
        "authorization": `Bearer ${ENV.minimaxApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(compactObject({
        model: ENV.minimaxModel,
        text: speechText,
        stream: false,
        language_boost: ENV.minimaxLanguageBoost,
        output_format: responseFormat,
        voice_setting: compactObject({
          voice_id: voiceId,
          speed: ENV.minimaxSpeed,
          vol: ENV.minimaxVolume,
          pitch: ENV.minimaxPitch,
          emotion: ENV.minimaxEmotion,
        }),
        audio_setting: compactObject({
          sample_rate: ENV.minimaxSampleRate,
          bitrate: ENV.minimaxBitrate,
          format: audioFormat,
          channel: ENV.minimaxChannel,
        }),
      })),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`MiniMax HTTP ${response.status}: ${body.slice(0, 500)}`);
    }

    const body = await response.json().catch(() => ({})) as MiniMaxTTSResponse;
    const statusCode = body.base_resp?.status_code ?? 0;
    if (statusCode !== 0) {
      throw new Error(`MiniMax status ${statusCode}: ${body.base_resp?.status_msg || "unknown error"}`);
    }
    const audio = body.data?.audio;
    if (!audio) {
      throw new Error(`MiniMax response did not include audio data; trace_id=${body.trace_id || "unknown"}`);
    }

    const audioBuffer = responseFormat === "url"
      ? await downloadMiniMaxAudio(audio)
      : decodeMiniMaxAudio(audio);
    await writeFile(filePath, audioBuffer);

    return { filePath, urlPath, voice: voiceId, provider: "minimax", format: audioFormat };
  } finally {
    clearTimeout(timer);
  }
}

async function runWindowsSapi(textPath: string, outputPath: string, voice: string): Promise<void> {
  const script = `
param([string]$TextPath, [string]$OutputPath, [string]$VoiceName)
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voices = $synth.GetInstalledVoices()
$selected = $voices | Where-Object { $_.VoiceInfo.Name -eq $VoiceName } | Select-Object -First 1
if (-not $selected) {
  $selected = $voices | Where-Object { $_.VoiceInfo.Culture.Name -eq "zh-CN" } | Select-Object -First 1
}
if ($selected) {
  $synth.SelectVoice($selected.VoiceInfo.Name)
}
$text = [System.IO.File]::ReadAllText($TextPath, [System.Text.Encoding]::UTF8)
$synth.SetOutputToWaveFile($OutputPath)
$synth.Speak($text)
$synth.SetOutputToNull()
$synth.Dispose()
`;
  const scriptPath = path.join(path.dirname(textPath), "sapi-tts.ps1");
  await writeFile(scriptPath, script, "utf8");

  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      textPath,
      outputPath,
      voice,
    ], {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", chunk => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `powershell.exe exited with code ${code}`));
    });
  });
}

async function generateWindowsSapiTTSFile(
  text: string,
  voice: string,
): Promise<TTSResult> {
  const hash = getCacheKey(text, voice, "windows-sapi");
  const fileName = `${hash}.wav`;
  const filePath = path.join(TTS_DIR, fileName);
  const urlPath = `/uploads/tts/${fileName}`;

  if (existsSync(filePath)) return { filePath, urlPath, voice, provider: "windows-sapi", format: "wav" };

  if (!existsSync(TTS_DIR)) mkdirSync(TTS_DIR, { recursive: true });

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mirrai-tts-"));
  const textPath = path.join(tempDir, "input.txt");
  try {
    await writeFile(textPath, text, "utf8");
    await runWindowsSapi(textPath, filePath, voice);
    if (!existsSync(filePath)) {
      throw new Error("Windows SAPI did not create an audio file");
    }
    return { filePath, urlPath, voice, provider: "windows-sapi", format: "wav" };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
