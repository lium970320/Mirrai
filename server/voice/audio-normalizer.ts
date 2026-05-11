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
      return {
        ok: false,
        status: "voice_transcode_failed",
        inputFormat,
        reason,
      };
    }
  }

  console.warn(`voice_transcode_failed input=${inputFormat} reason=unsupported_codec`);
  return {
    ok: false,
    status: "unsupported_voice_codec",
    inputFormat,
    reason: `${inputFormat} is not supported for ASR without ffmpeg`,
  };
}
