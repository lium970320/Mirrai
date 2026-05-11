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
        cfg_value = float(request.get("cfgValue") or 2.0)
        inference_timesteps = int(request.get("inferenceTimesteps") or 10)
        normalize = _bool(request.get("normalize"), True)
        denoise = _bool(request.get("denoise"), False)

        if reference_audio_path and not Path(reference_audio_path).exists():
            raise FileNotFoundError(f"referenceAudioPath does not exist: {reference_audio_path}")

        final_text = text if prompt_text else (f"({control}){text}" if control else text)
        generate_kwargs: dict[str, Any] = {
            "text": final_text,
            "cfg_value": cfg_value,
            "inference_timesteps": inference_timesteps,
            "normalize": normalize,
            "denoise": denoise,
        }
        if reference_audio_path:
            generate_kwargs["reference_wav_path"] = reference_audio_path
        if reference_audio_path and prompt_text:
            generate_kwargs["prompt_wav_path"] = reference_audio_path
            generate_kwargs["prompt_text"] = prompt_text

        with self._lock:
            model = self._model or self._load_model()
            started = time.perf_counter()
            wav = model.generate(**generate_kwargs)
            sample_rate = int(model.tts_model.sample_rate)

        import soundfile as sf

        sf.write(str(output_path), wav, sample_rate)
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

