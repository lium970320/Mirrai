import { createHash } from "crypto";
import { spawn } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { mkdtemp, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { ENV } from "./env";

const UPLOAD_DIR = ENV.uploadDir || "./uploads";
const TTS_DIR = path.resolve(UPLOAD_DIR, "tts");
const DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural";
const MAX_TEXT_LENGTH = 500;
type TTSProvider = "edge" | "windows-sapi" | "voxcpm" | "auto";
type TTSResult = {
  filePath: string;
  urlPath: string;
  voice: string;
  provider: "edge" | "windows-sapi" | "voxcpm";
  format: "mp3" | "wav";
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
  if (provider === "windows-sapi") {
    return generateWindowsSapiTTSFile(trimmed, voice);
  }
  if (provider === "voxcpm") {
    try {
      return await generateVoxcpmTTSFile(trimmed, voice);
    } catch (err) {
      console.warn(`tts_voxcpm_failed fallback=${ENV.ttsFallbackProvider}`, err);
      const fallbackProvider = normalizeProvider(ENV.ttsFallbackProvider);
      return generateTTSFile(
        trimmed,
        voice,
        fallbackProvider === "voxcpm" ? (process.platform === "win32" ? "windows-sapi" : "edge") : fallbackProvider,
      );
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
  if (provider === "edge" || provider === "windows-sapi" || provider === "voxcpm" || provider === "auto") return provider;
  return "auto";
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

function voxcpmCacheKey(text: string, voice: string): string {
  return [
    text,
    voice,
    ENV.voxcpmControl,
    ENV.voxcpmReferenceAudioPath,
    ENV.voxcpmPromptText,
    String(ENV.voxcpmCfgValue),
    String(ENV.voxcpmInferenceSteps),
    String(ENV.voxcpmNormalize),
    String(ENV.voxcpmDenoise),
  ].join("\n");
}

async function generateVoxcpmTTSFile(text: string, voice: string): Promise<TTSResult> {
  const hash = getCacheKey(voxcpmCacheKey(text, voice), "voxcpm", "voxcpm");
  const fileName = `${hash}.wav`;
  const filePath = path.join(TTS_DIR, fileName);
  const urlPath = `/uploads/tts/${fileName}`;

  if (existsSync(filePath)) return { filePath, urlPath, voice, provider: "voxcpm", format: "wav" };
  if (!existsSync(TTS_DIR)) mkdirSync(TTS_DIR, { recursive: true });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ENV.voxcpmTimeoutMs);
  try {
    const response = await fetch(`${ENV.voxcpmServiceUrl.replace(/\/+$/, "")}/tts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text,
        outputPath: filePath,
        control: ENV.voxcpmControl,
        referenceAudioPath: ENV.voxcpmReferenceAudioPath || null,
        promptText: ENV.voxcpmPromptText || null,
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
    return { filePath, urlPath, voice, provider: "voxcpm", format: "wav" };
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
