# VoxCPM QQ Voice Reply

Mirrai can use a local VoxCPM service as the QQ voice-reply TTS backend. Keep all heavy runtime files outside the Google Drive source tree.

## Local Paths

- Source-sync copy: `F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai`
- Local run copy: `F:/Code/Mirrai`
- VoxCPM runtime: `F:/.mirrai-local/Mirrai/voxcpm`
- Hugging Face cache: `F:/.mirrai-local/Mirrai/huggingface`
- ModelScope cache: `F:/.mirrai-local/Mirrai/modelscope`

Do not install VoxCPM, Python packages, or model weights inside the Google Drive source tree.

## Setup

From the source tree:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/sync-local-worktree.ps1
powershell -ExecutionPolicy Bypass -File scripts/setup-voxcpm.ps1
powershell -ExecutionPolicy Bypass -File scripts/start-voxcpm.ps1
```

On Windows with an NVIDIA GPU, setup installs CUDA PyTorch wheels into the local VoxCPM venv by default. To force CPU-only setup:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-voxcpm.ps1 -SkipCudaTorch
```

If Hugging Face access is slow, run setup with:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-voxcpm.ps1 -UseHfMirror
```

## Mirrai Environment

Set these in the local worktree `.env`, for example `F:/Code/Mirrai/.env`:

```env
QQ_TTS_PROVIDER=voxcpm
# 建议设为 none：VoxCPM 失败或超时时退回文字，不要突然改用系统 TTS 音色。
QQ_TTS_FALLBACK_PROVIDER=none
QQ_VOICE_REPLY_MODE=smart
QQ_VOICE_REPLY_ONLY_WHEN_USER_SENT_VOICE=false
QQ_VOICE_REPLY_MAX_TEXT_LENGTH=45
QQ_VOICE_REPLY_COOLDOWN_SECONDS=90
QQ_VOICE_REPLY_SMART_PROVIDER=deepseek
QQ_VOICE_REPLY_SMART_MIN_CONFIDENCE=0.68
VOXCPM_SERVICE_URL=http://127.0.0.1:8818
VOXCPM_TIMEOUT_MS=120000
VOXCPM_CONTROL=年轻男性，声音温和低沉，克制自然，语速中等偏慢，句间有自然停顿，像近距离日常聊天，不要朗读腔
VOXCPM_CLONE_MODE=controllable
VOXCPM_NORMALIZE=false
VOXCPM_INFERENCE_STEPS=20
VOXCPM_SPEECH_ENRICHMENT=local
```

Without a reference audio, VoxCPM uses voice design from `VOXCPM_CONTROL`. `VOXCPM_TIMEOUT_MS=120000` keeps QQ responsive: if local generation takes longer than about 2 minutes, Mirrai should fall back to text instead of waiting indefinitely.

`QQ_VOICE_REPLY_MODE=smart` lets the configured LLM decide whether a reply is natural enough to send as voice. Explicit phrases such as "用语音回我" / "发语音" / "你说出来" have the highest priority and will try voice for the whole reply turn. For non-explicit smart voice, keep `QQ_VOICE_REPLY_MAX_TEXT_LENGTH=45` so the generated audio usually stays within about 10 seconds; longer replies fall back to text to avoid slow VoxCPM generation and unstable long-form audio.

When a QQ turn is selected for voice, the text reply is synthesized into one audio message. The text splitter can still be used for normal text replies and voice policy checks, but voice delivery should not send one audio file per text chunk.

For daily QQ voice replies, prefer controllable cloning:

```env
VOXCPM_CLONE_MODE=controllable
VOXCPM_REFERENCE_AUDIO_PATH=F:/path/to/reference.wav
VOXCPM_PROMPT_TEXT=
```

This uses the reference audio for timbre and `VOXCPM_CONTROL` for pace, emotion, and speaking style. It usually feels more flexible for short chat replies.

## Speech Performance Enrichment

`VOXCPM_SPEECH_ENRICHMENT` controls how much Mirrai rewrites a text reply before sending it to VoxCPM:

- `off`: send only the existing reply text after minimal punctuation cleanup.
- `local`: use local rules to add spoken pauses and a richer VoxCPM control prompt.
- `llm`: call the configured LLM first to create a short spoken script plus performance control. If the LLM fails or returns invalid output, Mirrai falls back to `local`.

For `llm`, you can optionally set:

```env
VOXCPM_SPEECH_ENRICHMENT_PROVIDER=deepseek
```

The enrichment layer must not add new facts or visible stage directions. It should only adjust punctuation, pauses, and voice-control wording.

For highest-similarity cloning, use Hi-Fi mode:

```env
VOXCPM_CLONE_MODE=hifi
VOXCPM_REFERENCE_AUDIO_PATH=F:/path/to/reference.wav
VOXCPM_PROMPT_TEXT=Exact transcript of the reference audio.
```

Hi-Fi mode uses the prompt audio plus transcript and ignores the control instruction. It can preserve the reference voice more closely, but it is less controllable for pauses and emotion.

## Status

```powershell
powershell -ExecutionPolicy Bypass -File scripts/status-voxcpm.ps1
powershell -ExecutionPolicy Bypass -File scripts/stop-voxcpm.ps1
```
