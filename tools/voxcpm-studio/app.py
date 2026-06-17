"""VoxCPM Studio —— 独立的本地 TTS 试音台后端代理。

职责（刻意保持轻量）：
  1. 托管前端工作台（static/）。
  2. 把浏览器的合成请求转发给现有的 VoxCPM HTTP 服务（默认 127.0.0.1:8818）。
  3. 从 Mirrai 运行树 .env 读取王芃泽的克隆音色配置（参考音频 + 控制提示），
     让 5 个情绪 profile 直接产出王芃泽的声音；也支持用户上传自己的参考音频。
  4. 让 VoxCPM 直接把 WAV 写进运行时根的 outputs/，本服务以静态文件回放给浏览器。

本服务不加载任何模型；参考音频的绝对路径只留在后端，按 profileId 注入，不暴露给前端。
"""

from __future__ import annotations

import os
import uuid
from pathlib import Path

import httpx
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.staticfiles import StaticFiles

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

# 现有 VoxCPM 服务地址；与 Mirrai 的 .env 同名变量保持一致，方便共用。
VOXCPM_SERVICE_URL = os.environ.get("VOXCPM_SERVICE_URL", "http://127.0.0.1:8818").rstrip("/")
# 单次合成超时（秒）。模型首次加载较慢，给足余量。
TTS_TIMEOUT = float(os.environ.get("VOXCPM_STUDIO_TIMEOUT", "180"))

# Mirrai 运行树 .env：克隆音色（参考音频 / 控制提示 / prompt）的单一数据源，与 QQ 语音一致。
MIRRAI_ENV_PATH = os.environ.get("MIRRAI_ENV_PATH", "F:/Code/Mirrai/.env")

# 基础音色描述（.env 缺失时的回退默认）。
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
    """.env 未给某 profile 配 control 时的回退（与 voxcpm-voice-profile.ts 一致）。"""
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
    except Exception:  # noqa: BLE001 - 读不到就回退到通用音色
        return data
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        data[key.strip()] = value.strip().strip('"').strip("'")
    return data


def build_profiles():
    """从 Mirrai .env 构建情绪 profile：
    返回 (前端用列表, 按 id 的完整映射, 克隆模式, 是否有可用克隆音色)。
    """
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
        public.append({
            "id": pid,
            "label": label,
            "moods": moods,
            "control": ctrl,
            "hasReference": has_ref,
        })
        by_id[pid] = {
            "id": pid,
            "label": label,
            "control": ctrl,
            "referenceAudioPath": ref if has_ref else "",
            "promptText": prompt,
            "cloneMode": clone_mode,
        }
    return public, by_id, clone_mode, any_ref


PUBLIC_PROFILES, PROFILE_BY_ID, VOICE_CLONE_MODE, VOICE_AVAILABLE = build_profiles()
# 克隆音色的展示名；有可用参考音频时才显示（默认王芃泽，可用环境变量覆盖）。
VOICE_NAME = os.environ.get("VOXCPM_STUDIO_VOICE_NAME", "王芃泽") if VOICE_AVAILABLE else ""

DEFAULTS = {
    "cloneMode": VOICE_CLONE_MODE,
    "cfgValue": 2.0,
    "inferenceTimesteps": 20,
    "normalize": False,
    "denoise": False,
}

# 允许的参考音频扩展名，避免随意落盘。
ALLOWED_AUDIO_EXT = {".wav", ".mp3", ".flac", ".m4a", ".ogg", ".aac"}

app = FastAPI(title="VoxCPM Studio", docs_url=None, redoc_url=None)


@app.get("/api/config")
def get_config() -> dict:
    """前端启动时拉取：服务地址、音色名、profile 预设与默认参数。"""
    return {
        "voxcpmServiceUrl": VOXCPM_SERVICE_URL,
        "baseControl": BASE_CONTROL,
        "voiceName": VOICE_NAME,
        "voiceAvailable": VOICE_AVAILABLE,
        "cloneMode": VOICE_CLONE_MODE,
        "profiles": PUBLIC_PROFILES,
        "defaults": DEFAULTS,
    }


@app.get("/api/health")
async def health() -> dict:
    """透传 VoxCPM /health，并补一个 connected 标记供前端显示连接状态。"""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{VOXCPM_SERVICE_URL}/health")
        data = resp.json()
        return {"connected": True, "serviceUrl": VOXCPM_SERVICE_URL, **data}
    except Exception as exc:  # noqa: BLE001 - 任何连接错误都视为未连接
        return {
            "connected": False,
            "serviceUrl": VOXCPM_SERVICE_URL,
            "error": str(exc),
        }


@app.post("/api/upload-reference")
async def upload_reference(referenceAudio: UploadFile = File(...)) -> dict:
    """上传参考音频，落到 uploads/ 并返回一个可复用的 id（A/B 对比时无需重复上传）。"""
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


def _resolve_reference(reference_audio_id: str) -> str:
    """把前端传回的 referenceAudioId 解析成本机绝对路径；防止路径穿越。"""
    if not reference_audio_id:
        return ""
    candidate = (UPLOAD_DIR / reference_audio_id).resolve()
    if UPLOAD_DIR.resolve() not in candidate.parents or not candidate.exists():
        raise HTTPException(400, "参考音频不存在或已失效，请重新上传")
    return str(candidate)


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
    """核心合成：决定参考音频来源 → 组装 payload → 转发 VoxCPM → 回放 URL。

    参考音频优先级：用户上传 > 内置 profile 的克隆音色（王芃泽）> 无（纯控制提示）。
    """
    text = text.strip()
    if not text:
        raise HTTPException(400, "文本不能为空")

    reference_path = ""
    mode = cloneMode
    prompt = promptText

    if referenceAudioId:
        # 用户上传了自己的参考音频，按前端选择的模式克隆。
        reference_path = _resolve_reference(referenceAudioId)
    elif profileId and profileId in PROFILE_BY_ID:
        prof = PROFILE_BY_ID[profileId]
        if prof["referenceAudioPath"]:
            # 内置克隆音色（王芃泽）：用后端配置的参考音频与克隆模式。
            reference_path = prof["referenceAudioPath"]
            mode = prof["cloneMode"]
            if not prompt:
                prompt = prof["promptText"]

    out_id = uuid.uuid4().hex
    out_path = OUTPUT_DIR / f"{out_id}.wav"
    payload = {
        "text": text,
        "outputPath": str(out_path),
        "control": control,
        "cloneMode": mode,
        "referenceAudioPath": reference_path,
        "promptText": prompt,
        "cfgValue": cfgValue,
        "inferenceTimesteps": inferenceTimesteps,
        "normalize": normalize,
        "denoise": denoise,
    }

    try:
        async with httpx.AsyncClient(timeout=TTS_TIMEOUT) as client:
            resp = await client.post(f"{VOXCPM_SERVICE_URL}/tts", json=payload)
    except httpx.ConnectError:
        raise HTTPException(
            502,
            f"无法连接 VoxCPM 服务（{VOXCPM_SERVICE_URL}）。请先运行 scripts/start-voxcpm.ps1 启动服务。",
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
            raise HTTPException(
                502,
                "降噪失败：当前 VoxCPM 环境未安装 FFmpeg（torchcodec 依赖），降噪不可用。请关闭「降噪」后重试。",
            )
        # 只取首行并截断，避免把整段 Python traceback 糊到前端。
        first_line = raw_err.strip().splitlines()[0][:300]
        raise HTTPException(502, f"VoxCPM 生成失败：{first_line}")

    if not out_path.exists():
        raise HTTPException(502, "VoxCPM 返回成功但未找到输出文件")

    return {
        "ok": True,
        "id": out_id,
        "url": f"/audio/{out_id}.wav",
        "elapsedMs": data.get("elapsedMs"),
        "sampleRate": data.get("sampleRate"),
        "modelId": data.get("modelId"),
        "usedClone": bool(reference_path),
    }


# 静态资源挂载放最后，避免覆盖上面的 /api 路由。
app.mount("/audio", StaticFiles(directory=str(OUTPUT_DIR)), name="audio")
app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
