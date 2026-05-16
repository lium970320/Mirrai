# MiniMax QQ Voice Reply

Mirrai can use MiniMax T2A v2 as the QQ voice-reply TTS backend. DeepSeek can remain the chat LLM; only voice synthesis is routed to MiniMax.

## Voice Material

Use the cleaned Wang Pengze reference audio prepared on this machine:

```text
E:/Mirrai/VoiceData/wang-pengze/clean/wang_pengze_best_quality_20_30s_reference_24k.wav
```

MiniMax voice cloning accepts `mp3`, `m4a`, or `wav`, with source audio from 10 seconds to 5 minutes and no larger than 20 MB. The selected reference is about 22 seconds, so it is suitable for quick cloning.

## Clone Flow

1. Open the MiniMax platform and create an API key.
2. Upload the cleaned reference audio for voice cloning.
3. Create a cloned voice with a stable custom `voice_id`, for example `wang_pengze_liu_v1`.
4. Put the API key and cloned `voice_id` in the local worktree `.env`.

Keep secrets only in the local runtime worktree, for example `E:/Code/Mirrai` or another non-Google-Drive run copy. Do not commit API keys.

## Mirrai Environment

Set these in the local run copy `.env`:

```env
QQ_TTS_PROVIDER=minimax
QQ_TTS_FALLBACK_PROVIDER=windows-sapi
QQ_TTS_VOICE=wang_pengze_liu_v1

MINIMAX_API_KEY=your-minimax-api-key
MINIMAX_BASE_URL=https://api.minimax.io/v1
MINIMAX_MODEL=speech-2.8-hd
MINIMAX_VOICE_ID=wang_pengze_liu_v1
MINIMAX_LANGUAGE_BOOST=Chinese
MINIMAX_RESPONSE_FORMAT=hex
MINIMAX_AUDIO_FORMAT=mp3
MINIMAX_SAMPLE_RATE=32000
MINIMAX_BITRATE=128000
MINIMAX_CHANNEL=1
MINIMAX_SPEED=0.95
MINIMAX_VOLUME=1
MINIMAX_PITCH=0
MINIMAX_TEXT_HUMANIZE=true
MINIMAX_TIMEOUT_MS=120000
```

`QQ_TTS_VOICE` is passed as the MiniMax `voice_id`. `MINIMAX_VOICE_ID` is used as a fallback when a caller does not provide a MiniMax voice id.

If the MiniMax console still shows an account group id, set:

```env
MINIMAX_GROUP_ID=your-group-id
```

Current MiniMax docs do not require the group id for the default international endpoint, so leave it empty unless your account/API key specifically needs it.

## Style Notes

Use `speech-2.8-hd` first for emotional quality. If latency or cost matters more than expressiveness, switch to `speech-2.8-turbo`.

Recommended first tuning pass:

```env
MINIMAX_SPEED=0.92
MINIMAX_PITCH=0
MINIMAX_VOLUME=1
```

For the Wang Pengze persona, avoid overusing explicit emotion fields at first. Let the persona text and punctuation drive the tone, then adjust speed and pitch after listening to a few real QQ replies.
