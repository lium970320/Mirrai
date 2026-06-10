import { spawn } from "child_process";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { recordOperationsEvent } from "../_core/operations-events";

export type AudioFormat = "wav" | "mp3" | "m4a" | "ogg" | "flac" | "silk" | "amr" | "unknown";

export type AudioNormalizeSuccess = {
  ok: true;
  buffer: Buffer<ArrayBufferLike>;
  fileName: string;
  mimeType: string;
  inputFormat: AudioFormat;
  outputFormat: "wav" | "mp3" | "m4a";
  durationMs?: number;
};

export type AudioNormalizeFailure = {
  ok: false;
  status: "unsupported_voice_codec" | "voice_transcode_failed";
  inputFormat: AudioFormat;
  reason: string;
};

export type AudioNormalizeResult = AudioNormalizeSuccess | AudioNormalizeFailure;

const DEFAULT_SILK_SAMPLE_RATE = 24_000;

export function detectAudioFormat(buffer: Buffer | Uint8Array, fileName = "", mimeType = ""): AudioFormat {
  const lowerName = fileName.toLowerCase();
  const lowerMime = mimeType.toLowerCase();
  const head = Buffer.from(buffer.subarray(0, Math.min(buffer.byteLength, 16)));

  if (head.length >= 8 && head.subarray(0, 4).toString("ascii") === "RIFF" && head.subarray(8, 12).toString("ascii") === "WAVE") return "wav";
  if (head.length >= 3 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return "mp3";
  if (head.length >= 3 && head.subarray(0, 3).toString("ascii") === "ID3") return "mp3";
  if (head.length >= 12 && head.subarray(4, 8).toString("ascii") === "ftyp") return "m4a";
  if (head.length >= 4 && head.subarray(0, 4).toString("ascii") === "OggS") return "ogg";
  if (head.length >= 4 && head.subarray(0, 4).toString("ascii") === "fLaC") return "flac";
  if (head.toString("ascii").includes("#!SILK_V3")) return "silk";
  if (head.length >= 6 && head.subarray(0, 6).toString("ascii") === "#!AMR\n") return "amr";
  if (/audio\/mpeg|audio\/mp3/.test(lowerMime) || lowerName.endsWith(".mp3")) return "mp3";
  if (/audio\/wav|audio\/x-wav/.test(lowerMime) || lowerName.endsWith(".wav")) return "wav";
  if (/audio\/mp4|audio\/m4a/.test(lowerMime) || lowerName.endsWith(".m4a")) return "m4a";
  if (/audio\/ogg/.test(lowerMime) || lowerName.endsWith(".ogg")) return "ogg";
  if (/audio\/flac/.test(lowerMime) || lowerName.endsWith(".flac")) return "flac";
  if (/silk/.test(lowerMime) || lowerName.endsWith(".silk") || lowerName.endsWith(".slk")) return "silk";
  if (/amr/.test(lowerMime) || lowerName.endsWith(".amr")) return "amr";
  return "unknown";
}

export function pcmS16leToWav(pcm: Uint8Array, sampleRate = DEFAULT_SILK_SAMPLE_RATE): Buffer<ArrayBuffer> {
  const dataSize = pcm.byteLength;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(dataSize, 40);
  Buffer.from(pcm).copy(wav, 44);
  return wav;
}

function outputFileName(inputName: string, outputExt: string): string {
  return inputName.replace(/\.[^.\\/]+$/i, "") + outputExt;
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegInstaller.path, args, {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("ffmpeg timed out"));
    }, 20_000);

    child.stderr.on("data", chunk => {
      stderr += String(chunk);
    });
    child.on("error", err => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", code => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));
    });
  });
}

async function transcodeWithFfmpegToWav(
  buffer: Buffer<ArrayBufferLike>,
  fileName: string,
  inputFormat: AudioFormat,
): Promise<AudioNormalizeSuccess> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mirrai-voice-"));
  const inputPath = path.join(tempDir, `input.${inputFormat === "unknown" ? "bin" : inputFormat}`);
  const outputPath = path.join(tempDir, "output.wav");

  try {
    await writeFile(inputPath, buffer);
    await runFfmpeg([
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      inputPath,
      "-ac",
      "1",
      "-ar",
      String(DEFAULT_SILK_SAMPLE_RATE),
      "-acodec",
      "pcm_s16le",
      outputPath,
    ]);
    const wav = await readFile(outputPath);
    console.info(`voice_transcode_success input=${inputFormat} output=wav bytes=${wav.byteLength}`);
    return {
      ok: true,
      buffer: wav,
      fileName: outputFileName(fileName, ".wav"),
      mimeType: "audio/wav",
      inputFormat,
      outputFormat: "wav",
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function normalizeAudioForAsr(
  buffer: Buffer<ArrayBufferLike>,
  fileName: string,
  mimeType = "",
): Promise<AudioNormalizeResult> {
  const inputFormat = detectAudioFormat(buffer, fileName, mimeType);
  console.info(`voice_format_detected input=${inputFormat} file=${fileName} bytes=${buffer.byteLength}`);

  if (inputFormat === "wav") {
    return { ok: true, buffer, fileName, mimeType: "audio/wav", inputFormat, outputFormat: "wav" };
  }
  if (inputFormat === "mp3") {
    return { ok: true, buffer, fileName, mimeType: "audio/mpeg", inputFormat, outputFormat: "mp3" };
  }
  if (inputFormat === "m4a") {
    return { ok: true, buffer, fileName, mimeType: "audio/mp4", inputFormat, outputFormat: "m4a" };
  }
  if (inputFormat === "amr" || inputFormat === "ogg" || inputFormat === "flac") {
    try {
      return await transcodeWithFfmpegToWav(buffer, fileName, inputFormat);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`voice_transcode_failed input=${inputFormat}`, reason);
      recordOperationsEvent({
        id: "voice.transcode_failed",
        scope: "voice",
        title: "语音转码失败",
        detail: "QQ 语音输入已下载，但 ffmpeg 转成 ASR 可用格式时失败。",
        rawError: reason,
        evidence: `input=${inputFormat}`,
      });
      return {
        ok: false,
        status: "voice_transcode_failed",
        inputFormat,
        reason,
      };
    }
  }
  if (inputFormat === "silk") {
    try {
      const { decode } = await import("silk-wasm");
      const decoded = await decode(buffer, DEFAULT_SILK_SAMPLE_RATE);
      const wav = pcmS16leToWav(decoded.data, DEFAULT_SILK_SAMPLE_RATE);
      console.info(`voice_transcode_success input=silk output=wav durationMs=${decoded.duration}`);
      return {
        ok: true,
        buffer: wav,
        fileName: outputFileName(fileName, ".wav"),
        mimeType: "audio/wav",
        inputFormat,
        outputFormat: "wav",
        durationMs: decoded.duration,
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn("voice_transcode_failed input=silk", reason);
      recordOperationsEvent({
        id: "voice.silk_decode_failed",
        scope: "voice",
        title: "SILK 语音解码失败",
        detail: "QQ SILK 语音无法解码成 WAV，语音输入会降级成文字提示。",
        rawError: reason,
        evidence: "input=silk",
      });
      return {
        ok: false,
        status: "voice_transcode_failed",
        inputFormat,
        reason,
      };
    }
  }

  console.warn(`voice_transcode_failed input=${inputFormat} reason=unsupported_codec`);
  recordOperationsEvent({
    id: "voice.unsupported_codec",
    scope: "voice",
    title: "语音格式不支持",
    detail: "收到的语音格式当前不能稳定进入 ASR，会降级到文字提示。",
    evidence: `input=${inputFormat}`,
  });
  return {
    ok: false,
    status: "unsupported_voice_codec",
    inputFormat,
    reason: `${inputFormat} is not supported for ASR without ffmpeg`,
  };
}
