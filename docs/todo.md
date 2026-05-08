# TODO

## 未开始

### 语音消息识别与偶尔语音回复

目标：为当前 Wechaty / wechat4u 接入异步语音消息能力，不做微信语音电话。

待做范围：

- 在 `server/wechat/message-handler.ts` 增加语音消息分支，识别 `Message.Type.Audio` 或 `rawPayload.MsgType === 34`。
- 新增语音输入链路：下载微信语音文件、归一化音频格式、调用 ASR 转写，并把转写文本交给现有 persona / LLM 回复流程。
- 新增语音输出链路：默认文字回复；配置允许时，按策略偶尔把短回复转成 mp3 并通过 FileBox 发回微信。
- 新增配置，例如 `voiceInput`、`voiceReply`、`asr`、`tts`、`paths`，默认保持可降级。
- 新增模块建议：
  - `server/voice/audio-resolver.ts`
  - `server/voice/audio-normalizer.ts`
  - `server/voice/speech-to-text.ts`
  - `server/voice/voice-reply-policy.ts`
  - `server/voice/text-to-speech.ts`
  - `server/voice/voice-sender.ts`
- 使用 OpenAI `gpt-4o-mini-transcribe` 做 ASR，使用 `gpt-4o-mini-tts` 做 TTS。
- 下载、转码、ASR、TTS、发送任一步失败时都不能中断主对话流程，需要自动退回文字回复或自然提示。

第一版不做：

- 微信语音电话、自动接听、实时通话。
- 原生微信语音条强适配。
- 强制 silk / amr 编码发送。
- 复杂声纹识别或多人说话分离。

验证要求：

- TypeScript 类型检查通过。
- `corepack pnpm run check` 通过。
- 失败路径没有未捕获异常。
- 日志能区分语音下载、格式检测、转码、ASR、TTS、发送和降级原因。

### 角色主动发表情包

目标：为当前 Wechaty / wechat4u 接入稳定、自然、低频、可控的角色主动表情包功能。第一版不追求微信原生收藏表情，只使用本地 PNG / JPG / GIF 文件，通过 FileBox 发送。

待做范围：

- 新增表情包素材库 `server/stickers/persona-stickers.ts`，使用本地路径，不依赖外部 URL。
- 每个素材对象包含 `id`、`path`、`enabled`、`mood`、`tags`、`intensity`、`type`、`description`。
- 素材情绪方向至少覆盖：开心、害羞、撒娇、无语、吐槽、委屈、安慰、生气（轻度）、认同、得意、困惑。
- 新增表情包配置 `server/config/sticker.ts`，包含启用开关、概率、最大回复长度、冷却时间、群聊限制、用户发梗/调侃/表情后的加权开关、最近使用去重数量、素材根目录。
- 新增策略模块 `server/stickers/sticker-policy.ts`，根据回复长度、冷却、群聊、用户是否发了表情包/玩笑/调侃、当前内容是否严肃或技术化，决定是否允许发表情包。
- 修改 persona / LLM 回复链路，让模型除 `replyText` 外可输出结构化 `stickerIntent`，只表达情绪意图，不指定具体文件路径。
- 新增选择器 `server/stickers/sticker-selector.ts`，按 mood、intensity、tags 从素材库选择合适表情包，并避免连续重复。
- 新增发送器 `server/stickers/sticker-sender.ts`，用 `FileBox.fromFile(path)` 发送 PNG / JPG / GIF。
- 主流程推荐顺序：先正常发送文字回复，再按策略和意图尝试发送表情包。

配置建议：

```ts
export const stickerConfig = {
  stickerReply: {
    enabled: true,
    probability: 0.2,
    maxReplyLength: 80,
    cooldownSeconds: 60,
    allowInGroup: false,
    allowAfterUserSticker: true,
    allowAfterUserJoke: true,
    allowAfterUserTease: true,
    avoidRepeatRecentCount: 3,
  },
  paths: {
    stickerBaseDir: "assets/stickers/persona",
  },
};
```

适合发表情包：

- 用户发来表情包。
- 用户调侃、撒娇、吐槽、开玩笑。
- 用户表达强烈情绪。
- 机器人回复是短句、情绪化回应或角色化回应。
- 机器人表达害羞、无语、安慰、轻微吐槽。

不适合发表情包：

- 严肃问题、技术问题、信息查询。
- 学术、作业批改、代码分析、解释性长文。
- 明确要求简洁、专业、正式的对话。
- 回复文本太长或刚刚发过表情包。
- 群聊默认不发，除非配置允许。

降级要求：

- `stickerReply.enabled = false` 时完全不发表情包，正常文字回复。
- LLM 没返回 `stickerIntent` 时默认不发表情包。
- `stickerIntent.shouldSend = true` 但没选到图时，只保留文字回复。
- 文件不存在、路径错误、FileBox 构建失败、微信发送失败时，只保留文字回复并记录日志。
- 任意表情包失败都不能中断主对话流程。

日志要求：

- `sticker_policy_checked`
- `sticker_skipped_by_config`
- `sticker_skipped_by_length`
- `sticker_skipped_by_cooldown`
- `sticker_skipped_by_group`
- `sticker_selected_by_policy`
- `sticker_intent_detected`
- `sticker_candidate_found`
- `sticker_selected`
- `sticker_not_found`
- `sticker_send_start`
- `sticker_send_success`
- `sticker_send_failed`
- `sticker_send_failed_fallback_text`

实现优先级：

- P1：`persona-stickers.ts`、`sticker-policy.ts`、`sticker-selector.ts`、`sticker-sender.ts`、主流程接入、稳定降级。
- P2：最近使用去重、群聊差异策略、GIF 支持优化。
- P3：复杂检索、在线表情包生成、微信原生 Emoticon 研究。

第一版不做：

- 微信原生收藏表情发送。
- 微信商店 Emoticon 发送。
- 复杂表情包在线生成。
- 高频连续发表情包。
- 群聊高频刷屏。

验证要求：

- TypeScript 类型检查通过。
- `corepack pnpm run check` 通过。
- 没有未捕获异常。
- 表情包发送失败不影响文字回复。
- 日志能明确区分策略、选择、发送成功、发送失败和降级原因。
