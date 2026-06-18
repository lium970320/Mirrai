"""VoxCPM Studio —— 独立的本地 TTS 试音台后端代理。

职责（刻意保持轻量）：
  1. 托管前端工作台（static/）。
  2. 把浏览器的合成请求转发给现有的 VoxCPM HTTP 服务（默认 127.0.0.1:8818）。
  3. 从 Mirrai 运行树 .env 读取王芃泽的克隆音色配置（参考音频 + 控制提示），
     让 5 个情绪 profile 直接产出王芃泽的声音；也支持用户上传自己的参考音频。
  4. 分段合成：每段不同情绪/语速分别合成，再用标准库 wave 拼成一条（段间可插静音）。
  5. AI 表演增强：复用 Mirrai 的 LLM provider，把普通文本改写成有停顿/情绪的台词 + control。
  6. 让 VoxCPM 直接把 WAV 写进运行时根的 outputs/，本服务以静态文件回放给浏览器。

参考音频的绝对路径与 LLM key 只留在后端，不暴露给前端。
"""

from __future__ import annotations

import json
import re
import uuid
import wave
import os
from pathlib import Path

import httpx
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

# 运行时产物（生成的音频、上传的参考音频）落在源码树之外的运行时根，
# 避免被 Google Drive 同步（遵循 AGENTS.md：不在同步盘存放 venv / 运行时数据）。
RUNTIME_DIR = Path(
    os.environ.get("VOXCPM_STUDIO_RUNTIME_DIR", "F:/.mirrai-local/Mirrai/voxcpm-studio")
)
OUTPUT_DIR = RUNTIME_DIR / "outputs"
UPLOAD_DIR = RUNTIME_DIR / "uploads"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

VOXCPM_SERVICE_URL = os.environ.get("VOXCPM_SERVICE_URL", "http://127.0.0.1:8818").rstrip("/")
TTS_TIMEOUT = float(os.environ.get("VOXCPM_STUDIO_TIMEOUT", "180"))

# Mirrai 运行树 .env：克隆音色与 LLM 配置的单一数据源。
MIRRAI_ENV_PATH = os.environ.get("MIRRAI_ENV_PATH", "F:/Code/Mirrai/.env")

BASE_CONTROL = (
    "年轻男性，声音温和低沉，克制自然，语速中等偏慢，"
    "句间有自然停顿，像近距离日常聊天，不要朗读腔"
)

PROFILE_META = [
    ("calm", "日常", ["日常", "平静", "普通回复"]),
    ("comfort", "安慰", ["安慰", "心疼", "疲惫", "难过", "陪伴"]),
    ("tease", "调侃", ["调侃", "玩笑", "轻松", "撒娇"]),
    ("angry_soft", "轻微不满", ["轻度生气", "不满", "吃醋", "提醒"]),
    ("sad_low", "低落深夜", ["低落", "深夜", "想念", "安静"]),
]


def _default_control_for(profile_id: str, base: str) -> str:
    suffix = {
        "comfort": "；低声温柔，带安慰和靠近一点的陪伴感；语速稍慢，句间停顿更明显，不要哭腔",
        "tease": "；语气轻松，带一点很轻的笑意和调侃感；不要油腻，不要夸张",
        "angry_soft": "；轻微不满但压着声音，不吼叫，不爆发；像熟人之间低声提醒",
        "sad_low": "；声音偏低，情绪收住，短句之间留停顿；适合深夜、想念、低落，不要演得很悲伤",
    }
    return base + suffix.get(profile_id, "")


def _parse_env_file(path: str) -> dict:
    """极简 .env 解析：KEY=VALUE，忽略空行与注释；值不做变量展开。"""
    data: dict[str, str] = {}
    try:
        text = Path(path).read_text(encoding="utf-8")
    except Exception:  # noqa: BLE001
        return data
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        data[key.strip()] = value.strip().strip('"').strip("'")
    return data


def build_profiles():
    """从 Mirrai .env 构建情绪 profile，返回 (前端列表, 按 id 映射, 克隆模式, 是否有克隆音色)。"""
    env = _parse_env_file(MIRRAI_ENV_PATH)
    base_control = env.get("VOXCPM_CONTROL") or BASE_CONTROL
    clone_mode = (env.get("VOXCPM_CLONE_MODE") or "controllable").strip().lower()
    if clone_mode not in {"controllable", "hifi", "design"}:
        clone_mode = "controllable"
    default_ref = env.get("VOXCPM_REFERENCE_AUDIO_PATH", "")
    default_prompt = env.get("VOXCPM_PROMPT_TEXT", "")

    public: list[dict] = []
    by_id: dict[str, dict] = {}
    any_ref = False
    for pid, label, moods in PROFILE_META:
        up = pid.upper()
        ref = env.get(f"VOXCPM_PROFILE_{up}_REFERENCE_AUDIO_PATH", "")
        if not ref and pid == "calm":
            ref = default_ref
        prompt = env.get(f"VOXCPM_PROFILE_{up}_PROMPT_TEXT", "")
        if not prompt and pid == "calm":
            prompt = default_prompt
        ctrl = env.get(f"VOXCPM_PROFILE_{up}_CONTROL", "")
        if not ctrl:
            ctrl = base_control if pid == "calm" else _default_control_for(pid, base_control)

        has_ref = bool(ref and Path(ref).exists())
        if has_ref:
            any_ref = True
        public.append({"id": pid, "label": label, "moods": moods, "control": ctrl, "hasReference": has_ref})
        by_id[pid] = {
            "id": pid, "label": label, "control": ctrl,
            "referenceAudioPath": ref if has_ref else "",
            "promptText": prompt, "cloneMode": clone_mode,
        }
    return public, by_id, clone_mode, any_ref


def _load_llm_config() -> dict:
    """读取 Mirrai .env 的 LLM provider（优先语音增强专用，其次默认 provider）。"""
    env = _parse_env_file(MIRRAI_ENV_PATH)
    provider = (
        env.get("VOXCPM_SPEECH_ENRICHMENT_PROVIDER")
        or env.get("DEFAULT_LLM_PROVIDER")
        or "deepseek"
    ).strip().lower()
    up = provider.upper()
    return {
        "provider": provider,
        "apiKey": env.get(f"{up}_API_KEY", "").strip(),
        "baseUrl": (env.get(f"{up}_BASE_URL", "") or "https://api.deepseek.com").strip().rstrip("/"),
        "model": (env.get(f"{up}_MODEL", "") or "deepseek-chat").strip(),
    }


PUBLIC_PROFILES, PROFILE_BY_ID, VOICE_CLONE_MODE, VOICE_AVAILABLE = build_profiles()
VOICE_NAME = os.environ.get("VOXCPM_STUDIO_VOICE_NAME", "王芃泽") if VOICE_AVAILABLE else ""
LLM_CONFIG = _load_llm_config()

DEFAULTS = {
    "cloneMode": VOICE_CLONE_MODE,
    "cfgValue": 2.0,
    "inferenceTimesteps": 20,
    "normalize": False,
    "denoise": False,
}

ALLOWED_AUDIO_EXT = {".wav", ".mp3", ".flac", ".m4a", ".ogg", ".aac"}

app = FastAPI(title="VoxCPM Studio", docs_url=None, redoc_url=None)


@app.middleware("http")
async def _no_store_static(request, call_next):
    # 开发期：前端静态资源不缓存，避免改了 js/css 后浏览器还用旧版。
    resp = await call_next(request)
    p = request.url.path
    if p == "/" or p.endswith((".js", ".css", ".html")):
        resp.headers["Cache-Control"] = "no-store, must-revalidate"
    return resp


# ── 工具函数 ─────────────────────────────────────────────
def _resolve_reference(reference_audio_id: str) -> str:
    """把 referenceAudioId 解析成本机绝对路径；防止路径穿越。"""
    if not reference_audio_id:
        return ""
    candidate = (UPLOAD_DIR / reference_audio_id).resolve()
    if UPLOAD_DIR.resolve() not in candidate.parents or not candidate.exists():
        raise HTTPException(400, "参考音频不存在或已失效，请重新上传")
    return str(candidate)


def _resolve_source(reference_audio_id: str, profile_id: str, prompt_text: str, clone_mode: str):
    """决定参考音频来源：用户上传 > 内置 profile 克隆音色 > 无。返回 (path, mode, prompt)。"""
    if reference_audio_id:
        return _resolve_reference(reference_audio_id), clone_mode, prompt_text
    if profile_id and profile_id in PROFILE_BY_ID:
        prof = PROFILE_BY_ID[profile_id]
        if prof["referenceAudioPath"]:
            return prof["referenceAudioPath"], prof["cloneMode"], (prompt_text or prof["promptText"])
    return "", clone_mode, prompt_text


async def _post_voxcpm(client: httpx.AsyncClient, payload: dict) -> dict:
    """转发一次 VoxCPM /tts，统一错误处理（含降噪缺 FFmpeg 的友好提示）。"""
    try:
        resp = await client.post(f"{VOXCPM_SERVICE_URL}/tts", json=payload)
    except httpx.ConnectError:
        raise HTTPException(
            502, f"无法连接 VoxCPM 服务（{VOXCPM_SERVICE_URL}）。请先运行 scripts/start-voxcpm.ps1 启动服务。"
        )
    except httpx.TimeoutException:
        raise HTTPException(504, "VoxCPM 生成超时（模型首次加载可能较慢，可稍后重试）。")
    try:
        data = resp.json()
    except Exception:  # noqa: BLE001
        raise HTTPException(502, f"VoxCPM 返回了非 JSON 响应：{resp.text[:200]}")
    if resp.status_code != 200 or not data.get("ok"):
        raw_err = str(data.get("error") or resp.text or "未知错误")
        if "libtorchcodec" in raw_err or "FFmpeg" in raw_err:
            raise HTTPException(502, "降噪失败：当前 VoxCPM 环境未安装 FFmpeg（torchcodec 依赖），降噪不可用。请关闭「降噪」后重试。")
        first_line = raw_err.strip().splitlines()[0][:300]
        raise HTTPException(502, f"VoxCPM 生成失败：{first_line}")
    return data


def _concat_wavs(segment_paths: list[Path], silence_ms_list: list[int], out_path: Path) -> None:
    """用标准库 wave 把多段 WAV 拼成一条（段间按需插静音）。各段需同采样率/位深/声道。"""
    with wave.open(str(segment_paths[0]), "rb") as w0:
        nchannels = w0.getnchannels()
        sampwidth = w0.getsampwidth()
        framerate = w0.getframerate()
    with wave.open(str(out_path), "wb") as out:
        out.setnchannels(nchannels)
        out.setsampwidth(sampwidth)
        out.setframerate(framerate)
        for i, p in enumerate(segment_paths):
            with wave.open(str(p), "rb") as w:
                out.writeframes(w.readframes(w.getnframes()))
            sil_ms = silence_ms_list[i] if i < len(silence_ms_list) else 0
            if sil_ms and sil_ms > 0:
                n_frames = int(framerate * sil_ms / 1000)
                out.writeframes(b"\x00" * (n_frames * sampwidth * nchannels))


def _extract_json(text: str):
    """从 LLM 返回里提取第一个 JSON 对象。"""
    if not text:
        return None
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    candidate = fenced.group(1) if fenced else None
    if candidate is None:
        brace = re.search(r"\{.*\}", text, re.DOTALL)
        candidate = brace.group(0) if brace else None
    if candidate is None:
        return None
    try:
        return json.loads(candidate)
    except Exception:  # noqa: BLE001
        return None


# ── 请求模型 ─────────────────────────────────────────────
class Segment(BaseModel):
    text: str
    control: str = ""
    cloneMode: str = "controllable"
    cfgValue: float = 2.0
    inferenceTimesteps: int = 20
    normalize: bool = False
    denoise: bool = False
    promptText: str = ""
    referenceAudioId: str = ""
    profileId: str = ""
    silenceAfterMs: int = 0


class MultiRequest(BaseModel):
    segments: list[Segment]


class EnrichRequest(BaseModel):
    text: str
    control: str = ""


# ── 路由 ────────────────────────────────────────────────
@app.get("/api/config")
def get_config() -> dict:
    return {
        "voxcpmServiceUrl": VOXCPM_SERVICE_URL,
        "baseControl": BASE_CONTROL,
        "voiceName": VOICE_NAME,
        "voiceAvailable": VOICE_AVAILABLE,
        "cloneMode": VOICE_CLONE_MODE,
        "profiles": PUBLIC_PROFILES,
        "defaults": DEFAULTS,
        "enrichAvailable": bool(LLM_CONFIG["apiKey"]),
        "enrichProvider": LLM_CONFIG["provider"],
    }


@app.get("/api/health")
async def health() -> dict:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{VOXCPM_SERVICE_URL}/health")
        data = resp.json()
        return {"connected": True, "serviceUrl": VOXCPM_SERVICE_URL, **data}
    except Exception as exc:  # noqa: BLE001
        return {"connected": False, "serviceUrl": VOXCPM_SERVICE_URL, "error": str(exc)}


@app.post("/api/upload-reference")
async def upload_reference(referenceAudio: UploadFile = File(...)) -> dict:
    ext = Path(referenceAudio.filename or "ref.wav").suffix.lower()
    if ext not in ALLOWED_AUDIO_EXT:
        raise HTTPException(400, f"不支持的音频格式：{ext or '(无扩展名)'}")
    ref_id = f"{uuid.uuid4().hex}{ext}"
    dest = UPLOAD_DIR / ref_id
    content = await referenceAudio.read()
    if not content:
        raise HTTPException(400, "上传的音频为空")
    dest.write_bytes(content)
    return {"ok": True, "referenceAudioId": ref_id, "filename": referenceAudio.filename}


@app.post("/api/tts")
async def tts(
    text: str = Form(...),
    control: str = Form(""),
    cloneMode: str = Form("controllable"),
    cfgValue: float = Form(2.0),
    inferenceTimesteps: int = Form(20),
    normalize: bool = Form(False),
    denoise: bool = Form(False),
    promptText: str = Form(""),
    referenceAudioId: str = Form(""),
    profileId: str = Form(""),
) -> dict:
    text = text.strip()
    if not text:
        raise HTTPException(400, "文本不能为空")

    reference_path, mode, prompt = _resolve_source(referenceAudioId, profileId, promptText, cloneMode)

    out_id = uuid.uuid4().hex
    out_path = OUTPUT_DIR / f"{out_id}.wav"
    payload = {
        "text": text, "outputPath": str(out_path), "control": control, "cloneMode": mode,
        "referenceAudioPath": reference_path, "promptText": prompt,
        "cfgValue": cfgValue, "inferenceTimesteps": inferenceTimesteps,
        "normalize": normalize, "denoise": denoise,
    }
    async with httpx.AsyncClient(timeout=TTS_TIMEOUT) as client:
        data = await _post_voxcpm(client, payload)
    if not out_path.exists():
        raise HTTPException(502, "VoxCPM 返回成功但未找到输出文件")
    return {
        "ok": True, "id": out_id, "url": f"/audio/{out_id}.wav",
        "elapsedMs": data.get("elapsedMs"), "sampleRate": data.get("sampleRate"),
        "modelId": data.get("modelId"), "usedClone": bool(reference_path),
    }


@app.post("/api/tts-multi")
async def tts_multi(req: MultiRequest) -> dict:
    """分段合成：每段单独 generate，再用 wave 拼接（段间插静音）。"""
    segs = [s for s in req.segments if s.text.strip()]
    if not segs:
        raise HTTPException(400, "没有有效的分段文本")

    seg_paths: list[Path] = []
    silences: list[int] = []
    total_ms = 0
    try:
        async with httpx.AsyncClient(timeout=TTS_TIMEOUT) as client:
            for i, s in enumerate(segs):
                ref, mode, prompt = _resolve_source(s.referenceAudioId, s.profileId, s.promptText, s.cloneMode)
                seg_out = OUTPUT_DIR / f"seg_{uuid.uuid4().hex}.wav"
                payload = {
                    "text": s.text.strip(), "outputPath": str(seg_out), "control": s.control,
                    "cloneMode": mode, "referenceAudioPath": ref, "promptText": prompt,
                    "cfgValue": s.cfgValue, "inferenceTimesteps": s.inferenceTimesteps,
                    "normalize": s.normalize, "denoise": s.denoise,
                }
                data = await _post_voxcpm(client, payload)
                if not seg_out.exists():
                    raise HTTPException(502, f"第 {i + 1} 段未生成音频")
                seg_paths.append(seg_out)
                silences.append(max(0, s.silenceAfterMs))
                total_ms += int(data.get("elapsedMs") or 0)

        out_id = uuid.uuid4().hex
        out_path = OUTPUT_DIR / f"{out_id}.wav"
        _concat_wavs(seg_paths, silences, out_path)
    finally:
        for p in seg_paths:
            try:
                p.unlink()
            except Exception:  # noqa: BLE001
                pass

    return {"ok": True, "id": out_id, "url": f"/audio/{out_id}.wav", "segments": len(segs), "elapsedMs": total_ms}


@app.post("/api/enrich")
async def enrich(req: EnrichRequest) -> dict:
    """AI 表演稿：调 LLM 把普通文本改写成带停顿/情绪的台词 + control。"""
    text = req.text.strip()
    if not text:
        raise HTTPException(400, "文本不能为空")
    if not LLM_CONFIG["apiKey"]:
        raise HTTPException(400, f"未配置 {LLM_CONFIG['provider']} 的 API key，无法使用 AI 表演增强。")

    system = (
        "你是中文微信语音的『表演稿导演』。把用户给的文本改写成更适合 TTS 朗读、"
        "有自然停顿与情绪起伏的版本。只返回一个 JSON 对象，含两个字段：\n"
        "- speechText：纯台词。可用省略号……、逗号、句号、问号制造停顿，把长句拆成短句。"
        "禁止出现任何括号、旁白、动作、情绪标签、SSML 或 [停顿] 之类标记。"
        "不要新增事实，不要把短句扩写成长篇。\n"
        "- control：一句给 TTS 的整体表演提示，用中文描述语气、情绪、语速和停顿风格，不超过 60 个汉字。\n"
        "只输出 JSON，不要任何解释或 markdown。"
    )
    user = f"原文：{text}"
    if req.control.strip():
        user += f"\n当前风格提示（可参考）：{req.control.strip()}"

    body = {
        "model": LLM_CONFIG["model"],
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "temperature": 0.3,
        "max_tokens": 800,
        "stream": False,
    }
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                f"{LLM_CONFIG['baseUrl']}/chat/completions",
                headers={"Authorization": f"Bearer {LLM_CONFIG['apiKey']}"},
                json=body,
            )
    except httpx.TimeoutException:
        raise HTTPException(504, "AI 表演增强超时（模型思考较久，可稍后重试）。")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"调用 LLM 失败：{exc}")

    if resp.status_code != 200:
        raise HTTPException(502, f"LLM 返回错误 {resp.status_code}：{resp.text[:200]}")
    try:
        content = resp.json()["choices"][0]["message"]["content"]
    except Exception:  # noqa: BLE001
        raise HTTPException(502, "LLM 返回格式异常")

    parsed = _extract_json(content)
    if parsed and isinstance(parsed, dict) and parsed.get("speechText"):
        return {
            "ok": True,
            "speechText": str(parsed.get("speechText", "")).strip(),
            "control": str(parsed.get("control", "") or req.control).strip(),
        }
    # 解析失败时把整段当台词回退，control 保持原样
    return {"ok": True, "speechText": content.strip(), "control": req.control, "fallback": True}


# 静态资源挂载放最后，避免覆盖上面的 /api 路由。
app.mount("/audio", StaticFiles(directory=str(OUTPUT_DIR)), name="audio")
app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
