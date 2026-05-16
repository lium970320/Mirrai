# TODO

## 未开始

### QQ 语音消息识别与偶尔语音回复

目标：为当前 QQ / NapCat / OneBot 接入更完整的异步语音消息能力，不做实时通话。

待做范围：

- 在 `server/qq/message-handler.ts` 增加或完善语音消息分支，识别 NapCat / OneBot 的 `record` 语音消息。
- 新增或完善语音输入链路：通过 OneBot 获取 QQ 语音文件、归一化音频格式、调用 ASR 转写，并把转写文本交给现有 persona / LLM 回复流程。
- 新增或完善语音输出链路：默认文字回复；配置允许或用户明确要求时，把回复文本转成语音文件并通过 OneBot 发回 QQ。
- 新增配置，例如 `voiceInput`、`voiceReply`、`asr`、`tts`、`paths`，默认保持可降级。
- 新增模块建议：
  - `server/voice/audio-resolver.ts`
  - `server/voice/audio-normalizer.ts`
  - `server/voice/speech-to-text.ts`
  - `server/voice/voice-reply-policy.ts`
  - `server/voice/text-to-speech.ts`
  - `server/voice/voice-sender.ts`
- ASR 优先使用当前已配置的智谱语音识别；TTS 优先使用 VoxCPM，本地生成失败时按配置退回文字。
- 下载、转码、ASR、TTS、发送任一步失败时都不能中断主对话流程，需要自动退回文字回复或自然提示。

第一版不做：

- QQ / 微信语音电话、自动接听、实时通话。
- 微信侧 wechat4u 语音接入。
- QQ 原生语音条强适配。
- 强制 silk / amr 编码发送。
- 复杂声纹识别或多人说话分离。

验证要求：

- TypeScript 类型检查通过。
- `corepack pnpm run check` 通过。
- 失败路径没有未捕获异常。
- 日志能区分语音下载、格式检测、转码、ASR、TTS、发送和降级原因。

## 已完成第一版，后续优化

### VoxCPM 多 voice profile / 情绪参考音频

已完成第一版：QQ 语音回复在进入 VoxCPM 前会根据回复文本选择 `calm`、`comfort`、`tease`、`angry_soft`、`sad_low` profile。

已完成范围：

- 新增 `server/voice/voxcpm-voice-profile.ts`，支持 profile 配置、文本规则选择和参考音频 fallback。
- 每个 profile 包含 `referenceAudioPath`、`promptText`、`control`、`moods`、`priority`。
- `server/_core/tts.ts` 已接入 profile 选择，profile 会进入 VoxCPM 缓存 key，避免不同 profile 复用同一缓存。
- 当前本机 `.env` 先复用 `calm` 参考音频，用不同 profile 的 `control` 区分情绪；以后有干净素材时再填 profile 专属音频路径。
- 缺失某个 profile 参考音频时，会复用默认 `calm` 的参考音频和 prompt，但保留该 profile 的情绪 control。
- 日志会记录 `voxcpm_voice_profile_selected` 和 `voxcpm_voice_profile_fallback`。

已验证：

- `corepack pnpm exec vitest run server/voice/voxcpm-voice-profile.test.ts server/_core/tts.test.ts`
- `corepack pnpm run check`

后续可优化：

- 给 `comfort`、`tease`、`angry_soft`、`sad_low` 分别补真实干净参考音频。
- 增加可选 LLM profile judge，用于比本地关键词更细地判断语气。
- 根据角色日程、夜间状态、半醒状态进一步影响 profile。

### QQ 角色主动发表情包

已完成 P1：QQ / NapCat / OneBot 侧稳定、自然、低频、可控的角色主动表情包功能。第一版只使用本地 PNG / JPG / GIF 文件，通过 OneBot `image` 消息段发送。

已完成范围：

- 新增表情包素材库 `server/stickers/persona-stickers.ts`，使用本地路径，不依赖外部 URL。
- 每个素材对象包含 `id`、`path`、`enabled`、`mood`、`tags`、`intensity`、`type`、`description`。
- 素材情绪方向至少覆盖：开心、害羞、撒娇、无语、吐槽、委屈、安慰、生气（轻度）、认同、得意、困惑。
- 新增 QQ 表情包配置项，包含启用开关、概率、最大回复长度、冷却时间、群聊限制、用户发梗/调侃/表情后的加权开关、最近使用去重数量、素材根目录。
- 新增策略模块 `server/stickers/sticker-policy.ts`，根据回复长度、冷却、群聊、用户是否发了表情包/玩笑/调侃、当前内容是否严肃或技术化，决定是否允许发表情包。
- 新增意图模块 `server/stickers/sticker-intent.ts`，第一版用本地规则生成结构化 `stickerIntent`，只表达情绪意图，不指定具体文件路径。
- 新增选择器 `server/stickers/sticker-selector.ts`，按 mood、intensity、tags 从素材库选择合适表情包，并避免连续重复。
- 新增发送器 `server/stickers/sticker-sender.ts`，通过 OneBot 发送 PNG / JPG / GIF。
- 主流程已接入 `server/qq/message-handler.ts`：先正常发送文字回复，再按策略和意图尝试发送表情包。语音回复场景不额外发表情包，避免刷屏。

配置项：

- `QQ_STICKER_REPLY_ENABLED`
- `QQ_STICKER_REPLY_PROBABILITY`
- `QQ_STICKER_REPLY_MAX_REPLY_LENGTH`
- `QQ_STICKER_REPLY_COOLDOWN_SECONDS`
- `QQ_STICKER_REPLY_ALLOW_GROUPS`
- `QQ_STICKER_REPLY_ALLOW_AFTER_USER_STICKER`
- `QQ_STICKER_REPLY_ALLOW_AFTER_USER_JOKE`
- `QQ_STICKER_REPLY_ALLOW_AFTER_USER_TEASE`
- `QQ_STICKER_REPLY_AVOID_REPEAT_RECENT_COUNT`
- `QQ_STICKER_BASE_DIR`

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

已实现降级：

- `QQ_STICKER_REPLY_ENABLED=false` 时完全不发表情包，正常文字回复。
- 本地意图模块没生成 `stickerIntent` 时默认不发表情包。
- `stickerIntent.shouldSend = true` 但没选到图时，只保留文字回复。
- 文件不存在、路径错误、OneBot 发送失败时，只保留文字回复并记录日志。
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

后续可优化：

- 用 LLM 做更细的 `stickerIntent` 判断，但仍只输出情绪意图，不指定文件路径。
- 替换 `assets/stickers/persona` 下的默认占位素材为真实角色表情包。
- 增加更多素材检索规则和更细的情绪标签。
- 优化 GIF 在不同 NapCat / OneBot 版本下的显示效果。
- 如以后恢复微信，再单独研究微信原生收藏表情 / Emoticon；当前不做微信侧。

第一版不做：

- 微信原生收藏表情发送。
- 微信商店 Emoticon 发送。
- 复杂表情包在线生成。
- 高频连续发表情包。
- 群聊高频刷屏。

已验证：

- `corepack pnpm run check` 通过。
- `corepack pnpm exec vitest run server/stickers/sticker-policy.test.ts server/stickers/sticker-selector.test.ts` 通过。
