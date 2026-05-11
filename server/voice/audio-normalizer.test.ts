import { describe, expect, it } from "vitest";
import { detectAudioFormat, pcmS16leToWav } from "./audio-normalizer";

describe("audio normalizer", () => {
  it("detects common ASR audio formats by magic bytes", () => {
    expect(detectAudioFormat(Buffer.from("524946460000000057415645", "hex"), "a.wav")).toBe("wav");
    expect(detectAudioFormat(Buffer.from("4944330300", "hex"), "a.mp3")).toBe("mp3");
    expect(detectAudioFormat(Buffer.from("#!SILK_V3"))).toBe("silk");
    expect(detectAudioFormat(Buffer.from("#!AMR\n"))).toBe("amr");
  });

  it("prefers SILK magic bytes over misleading amr extension", () => {
    expect(detectAudioFormat(Buffer.from("#!SILK_V3 test"), "voice.amr", "audio/amr")).toBe("silk");
    expect(detectAudioFormat(Buffer.concat([Buffer.from([0x02]), Buffer.from("#!SILK_V3 test")]), "voice.amr", "audio/amr")).toBe("silk");
  });

  it("wraps pcm_s16le data in a valid wav container", () => {
    const wav = pcmS16leToWav(Buffer.from([0, 0, 1, 0]), 24_000);

    expect(wav.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(wav.subarray(8, 12).toString("ascii")).toBe("WAVE");
    expect(wav.subarray(36, 40).toString("ascii")).toBe("data");
    expect(wav.readUInt32LE(40)).toBe(4);
    expect(wav.byteLength).toBe(48);
  });
});
