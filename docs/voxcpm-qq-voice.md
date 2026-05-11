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
QQ_TTS_FALLBACK_PROVIDER=windows-sapi
VOXCPM_SERVICE_URL=http://127.0.0.1:8818
VOXCPM_CONTROL=年轻男性，声音温和低沉，克制自然，语速中等，像近距离日常聊天
```

Without a reference audio, VoxCPM uses voice design from `VOXCPM_CONTROL`. For stable voice cloning, add:

```env
VOXCPM_REFERENCE_AUDIO_PATH=F:/path/to/reference.wav
VOXCPM_PROMPT_TEXT=
```

For highest-fidelity cloning, provide both a clean 5-30 second reference audio and its exact transcript in `VOXCPM_PROMPT_TEXT`.

## Status

```powershell
powershell -ExecutionPolicy Bypass -File scripts/status-voxcpm.ps1
powershell -ExecutionPolicy Bypass -File scripts/stop-voxcpm.ps1
```
