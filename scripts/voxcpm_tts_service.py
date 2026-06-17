import argparse
import json
import logging
import os
import re
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("voxcpm-tts-service")


def _bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).lower() in {"1", "true", "yes", "on"}


def _json(handler: BaseHTTPRequestHandler, status: int, payload: dict[str, Any]) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("content-type", "application/json; charset=utf-8")
    handler.send_header("content-length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _postprocess_generated_wav(wav: Any, sample_rate: int) -> Any:
    import numpy as np

    audio = np.asarray(wav, dtype=np.float32).squeeze()
    if audio.size <= 1:
        return audio

    # VoxCPM can occasionally produce a transient click at the very start.
    # Trim a tiny leading slice, then fade in so the first user-heard sample is smooth.
    trim_samples = min(int(sample_rate * 0.035), max(0, audio.size - 1))
    if trim_samples > 0 and audio.size > int(sample_rate * 0.5):
        audio = audio[trim_samples:]

    if audio.size > int(sample_rate * 2.0):
        tail_samples = min(int(sample_rate * 1.0), audio.size)
        tail = audio[-tail_samples:]
        tail_rms = float(np.sqrt(np.mean(np.square(tail)))) if tail.size else 0.0
        overall_rms = float(np.sqrt(np.mean(np.square(audio)))) if audio.size else 0.0
        window = np.hanning(tail.size).astype(np.float32)
        spectrum = np.abs(np.fft.rfft(tail * window)) ** 2
        freqs = np.fft.rfftfreq(tail.size, 1 / sample_rate)
        total = float(np.sum(spectrum)) + 1e-12
        band_800_1200 = float(np.sum(spectrum[(freqs >= 800) & (freqs <= 1200)]) / total)
        band_80_300 = float(np.sum(spectrum[(freqs >= 80) & (freqs < 300)]) / total)
        band_300_3500 = float(np.sum(spectrum[(freqs >= 300) & (freqs <= 3500)]) / total)

        if (
            tail_rms > overall_rms * 0.9
            and band_800_1200 > 0.18
            and band_80_300 < 0.15
            and band_300_3500 > 0.85
        ):
            end_trim_samples = min(int(sample_rate * 0.85), max(0, audio.size - int(sample_rate * 0.8)))
            if end_trim_samples > 0:
                audio = audio[:-end_trim_samples]
                logger.warning(
                    "voxcpm_trimmed_trailing_unstable_tone trim_ms=%s band_800_1200=%.3f tail_rms=%.4f overall_rms=%.4f",
                    int(end_trim_samples * 1000 / sample_rate),
                    band_800_1200,
                    tail_rms,
                    overall_rms,
                )

    end_trim_samples = min(int(sample_rate * 0.08), max(0, audio.size - int(sample_rate * 0.5)))
    if end_trim_samples > 0:
        audio = audio[:-end_trim_samples]

    fade_in_samples = min(int(sample_rate * 0.045), audio.size)
    if fade_in_samples > 1:
        audio[:fade_in_samples] *= np.linspace(0.0, 1.0, fade_in_samples, dtype=np.float32)

    fade_out_samples = min(int(sample_rate * 0.12), audio.size)
    if fade_out_samples > 1:
        audio[-fade_out_samples:] *= np.linspace(1.0, 0.0, fade_out_samples, dtype=np.float32)

    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak > 0.98:
        audio *= 0.98 / peak
    return audio


class VoxCPMState:
    def __init__(self, model_id: str, device: str, optimize: bool) -> None:
        self.model_id = model_id
        self.device = device
        self.optimize = optimize
        self._model = None
        self._lock = threading.Lock()

    @property
    def model_loaded(self) -> bool:
        return self._model is not None

    def _load_model(self):
        from voxcpm import VoxCPM

        logger.info("loading VoxCPM model=%s device=%s optimize=%s", self.model_id, self.device, self.optimize)
        kwargs: dict[str, Any] = {
            "device": self.device,
            "optimize": self.optimize,
        }
        self._model = VoxCPM.from_pretrained(self.model_id, **kwargs)
        logger.info("VoxCPM model loaded")
        return self._model

    def synthesize(self, request: dict[str, Any]) -> dict[str, Any]:
        text = str(request.get("text") or "").strip()
        if not text:
            raise ValueError("text is required")

        output_path = Path(str(request.get("outputPath") or "")).expanduser()
        if not str(output_path):
            raise ValueError("outputPath is required")
        output_path.parent.mkdir(parents=True, exist_ok=True)

        control = re.sub(r"[()（）]", "", str(request.get("control") or "")).strip()
        reference_audio_path = str(request.get("referenceAudioPath") or "").strip() or None
        prompt_text = str(request.get("promptText") or "").strip() or None
        clone_mode = str(request.get("cloneMode") or "controllable").strip().lower()
        if clone_mode not in {"controllable", "hifi", "design"}:
            clone_mode = "controllable"
        cfg_value = float(request.get("cfgValue") or 2.0)
        inference_timesteps = int(request.get("inferenceTimesteps") or 10)
        normalize = _bool(request.get("normalize"), False)
        denoise = _bool(request.get("denoise"), False)

        if reference_audio_path and not Path(reference_audio_path).exists():
            raise FileNotFoundError(f"referenceAudioPath does not exist: {reference_audio_path}")

        use_hifi_prompt = clone_mode == "hifi" and bool(reference_audio_path and prompt_text)
        # Official VoxCPM Hi-Fi cloning ignores control instructions and uses prompt audio + transcript.
        # Controllable cloning keeps only reference_wav_path and puts style/pace control before the text.
        final_text = text if use_hifi_prompt else (f"({control}){text}" if control else text)
        generate_kwargs: dict[str, Any] = {
            "text": final_text,
            "cfg_value": cfg_value,
            "inference_timesteps": inference_timesteps,
            "normalize": normalize,
            "denoise": denoise,
        }
        if reference_audio_path:
            generate_kwargs["reference_wav_path"] = reference_audio_path
        if use_hifi_prompt and reference_audio_path and prompt_text:
            generate_kwargs["prompt_wav_path"] = reference_audio_path
            generate_kwargs["prompt_text"] = prompt_text

        with self._lock:
            model = self._model or self._load_model()
            started = time.perf_counter()
            wav = model.generate(**generate_kwargs)
            sample_rate = int(model.tts_model.sample_rate)

        import soundfile as sf

        wav = _postprocess_generated_wav(wav, sample_rate)
        # 原子写入：先写临时文件再 os.replace，避免并发/中断时下游 existsSync 命中半成品 WAV。
        tmp_output = f"{output_path}.{os.getpid()}.tmp"
        # 临时文件扩展名是 .tmp，soundfile 无法从扩展名推断格式，必须显式指定 WAV。
        sf.write(tmp_output, wav, sample_rate, format="WAV")
        os.replace(tmp_output, str(output_path))
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        logger.info("generated output=%s sample_rate=%s elapsed_ms=%s", output_path, sample_rate, elapsed_ms)
        return {
            "ok": True,
            "outputPath": str(output_path),
            "sampleRate": sample_rate,
            "elapsedMs": elapsed_ms,
            "modelId": self.model_id,
        }


def make_handler(state: VoxCPMState):
    class Handler(BaseHTTPRequestHandler):
        server_version = "MirraiVoxCPM/1.0"

        def log_message(self, fmt: str, *args: Any) -> None:
            logger.info("%s - %s", self.client_address[0], fmt % args)

        def do_GET(self) -> None:
            if self.path == "/health":
                _json(
                    self,
                    200,
                    {
                        "ok": True,
                        "modelLoaded": state.model_loaded,
                        "modelId": state.model_id,
                        "device": state.device,
                        "optimize": state.optimize,
                    },
                )
                return
            _json(self, 404, {"ok": False, "error": "not_found"})

        def do_POST(self) -> None:
            if self.path != "/tts":
                _json(self, 404, {"ok": False, "error": "not_found"})
                return
            try:
                length = int(self.headers.get("content-length") or "0")
                payload = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
                _json(self, 200, state.synthesize(payload))
            except Exception as exc:
                logger.exception("tts failed")
                _json(self, 500, {"ok": False, "error": str(exc)})

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser(description="Local VoxCPM TTS service for Mirrai")
    parser.add_argument("--host", default=os.environ.get("VOXCPM_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("VOXCPM_PORT", "8818")))
    parser.add_argument("--model-id", default=os.environ.get("VOXCPM_MODEL_ID", "openbmb/VoxCPM2"))
    parser.add_argument("--device", default=os.environ.get("VOXCPM_DEVICE", "auto"))
    parser.add_argument("--optimize", action="store_true", default=_bool(os.environ.get("VOXCPM_OPTIMIZE"), False))
    args = parser.parse_args()

    state = VoxCPMState(model_id=args.model_id, device=args.device, optimize=args.optimize)
    server = ThreadingHTTPServer((args.host, args.port), make_handler(state))
    logger.info("VoxCPM service listening on http://%s:%s", args.host, args.port)
    server.serve_forever()


if __name__ == "__main__":
    main()
