# Mirrai 阶段 3 QQ 主链路稳定记录

记录时间：2026-06-08  
对应计划：[MIRRAI_WORK_PLAN.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_WORK_PLAN.md>)

## 本轮完成

### OneBot 事件级 fixture 覆盖

- 扩展 QQ 消息处理测试：[message-handler.test.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/qq/message-handler.test.ts>)
- 保留原有 helper 覆盖：
  - private / group contact key。
  - array message segments 文本抽取。
  - CQ-code 文本归一化。
  - `image` / `record` segment 抽取。
- 新增接近真实 OneBot 事件 fixture：
  - 普通 QQ 私聊文本进入共享 persona runtime，并通过 OneBot 文本发送回复。
  - 群聊在 `QQ_ALLOW_GROUPS=false` 时直接跳过，不进入 persona runtime。
  - `record` 语音缺少可解析文件时降级到文本提示。
  - base64 `record` 语音走下载 / 归一化 / ASR / 共享 persona runtime / TTS / OneBot record 发送。
  - 语音归一化 / 转码失败时降级到文本提示，不进入 ASR 或 persona runtime。
  - ASR 请求失败时降级到文本提示，不进入 persona runtime。
  - 语音输出发送失败时降级到文本回复。
  - base64 `image` 图片进入 QQ media runtime，并发送文本回复。
  - 图片没有可用媒体但带文本内容时，回退到文本占位内容进入共享 persona runtime。
  - 表情包策略命中但本地没有匹配文件时，主文本回复仍正常发送，不调用 OneBot 表情发送。
  - 表情包已选中但 OneBot image 发送失败时，主文本回复仍正常发送，失败只作为日志 fallback 记录。

### QQ 图片文件名修复

- 更新 [message-handler.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/qq/message-handler.ts>)。
- OneBot `base64://...` 图片现在使用稳定 fallback 文件名，例如 `qq-image-5-1.png`。
- 修复前会把 base64 内容当作文件名，导致 media runtime / 存储链路拿到不可读文件名。

### 语音输出链路回归保护

- handler 级日志现在区分：
  - `voice_in_download_failed`：OneBot record 文件无法解析 / 下载。
  - `voice_in_normalize_failed_fallback_text`：语音格式归一化或转码失败，包含 `status`、`inputFormat` 和 `reason`。
  - `voice_asr_failed_fallback_text`：ASR 失败，包含 `status`、`model` 和 `reason`。
  - `voice_tts_failed` / `voice_send_failed_fallback_text`：TTS 或 OneBot record 发送失败。
- 事件级测试覆盖 `voiceRequestDecision.explicitVoiceRequest=true` 时：
  - 调用 TTS。
  - 允许显式语音请求突破普通短语音长度限制。
  - OneBot record 发送成功时不重复发送文本。
  - OneBot record 发送失败时退回文本。
- 事件级测试覆盖语音输入失败边界：
  - 下载失败不进入归一化 / ASR。
  - 归一化失败不进入 ASR / persona runtime。
  - ASR 失败不进入 persona runtime。
- 测试中 mock 真实外部边界：OneBot、ASR、TTS、persona runtime、表情包发送，不触碰真实 QQ / NapCat / LLM / 数据库。

### 表情包 fallback 回归保护

- 测试环境将 QQ 语音策略固定为 `requested`，避免普通文本用例被随机语音回复路径抢走。
- 表情包策略在测试中固定开启且概率为 1，用真实 `detectStickerIntent` / `checkStickerReplyPolicy` / `selectSticker` 覆盖事件级分支。
- 通过 `fs.existsSync` spy 控制文件存在性：
  - 文件不存在时覆盖 `sticker_not_found`，确认文字回复已经发送且不会继续调用 `sendQqSticker`。
  - 文件存在但 `sendQqSticker` 返回 `onebot_send_failed` 时，确认文字回复已经发送且不会影响主链路。

### 关键日志 / 降级原因断言

- 在 [message-handler.test.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/qq/message-handler.test.ts>) 的 QQ 事件级测试中增加 `console.info` / `console.warn` spy。
- 已断言语音输入成功链路日志：
  - `voice_in_received`
  - `voice_in_download_success`
  - `voice_tts_start`
  - `voice_tts_success`
  - `voice_send_success`
- 已断言语音失败降级日志：
  - `voice_in_download_failed ... reason=no_record_info`
  - `voice_in_normalize_failed_fallback_text ... status=voice_transcode_failed`
  - `voice_asr_failed_fallback_text ... status=asr_request_failed`
  - `voice_send_failed_fallback_text`
- 已断言图片链路日志：
  - `[QQ] Handling image message`
  - `[QQ] Received image media`
  - `[QQ] Image segment 1 has no usable URL, base64 data, or local file path.`
  - `[QQ] Falling back to text-only image placeholder`
- 已断言表情包降级日志：
  - `sticker_not_found ... reason=no_matching_existing_sticker`
  - `sticker_send_failed_fallback_text ... reason=onebot_send_failed`
- 这组断言把“流程没有崩”和“日志能说明为什么降级”绑定在一起，避免后续改动只保留行为、丢失排障信号。

### QQ / OneBot 在线 E2E 只读预检脚本

- 新增只读脚本：[check-qq-e2e-readiness.ps1](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/scripts/check-qq-e2e-readiness.ps1>)。
- 脚本只检查状态，不启动、不停止、不重启 Mirrai、NapCat 或 QQ。
- 脚本读取本机运行目录 [F:/Code/Mirrai](<F:/Code/Mirrai>) 的 `.env`，但只展示 token / webhook secret 是否已配置，不打印真实密钥。
- 脚本输出最近日志信号前会脱敏 `token=...`、`WebUi Token: ...` 和 `Bearer ...`，方便后续把预检结果复制进排障记录。
- 检查范围：
  - 本机 `.env` 是否存在，`QQ_ENABLED`、OneBot base URL、群聊开关、自动绑定和快速登录配置。
  - Mirrai Web 是否可访问。
  - NapCat 默认目录下相关进程数量。
  - OneBot `get_login_info` 是否可访问，成功时显示登录用户。
  - 本机日志目录 [logs](<F:/.mirrai-local/Mirrai/logs>) 中最近 QQ、语音、表情包和主动消息关键信号。
  - 当前不满足 E2E 条件时的下一步操作。
- 支持 JSON 输出：

```powershell
cd F:\Code\Mirrai
powershell -ExecutionPolicy Bypass -File scripts/check-qq-e2e-readiness.ps1 -Json
```

- 2026-06-08 首次本机只读预检结果：
  - `.env` 存在，`QQ_ENABLED=true`。
  - Mirrai Web `OK (200)`。
  - NapCat 相关进程数为 `0`。
  - OneBot `NOT RESPONDING (无法连接到远程服务器)`。
  - 最近日志中仍能看到早些时候 QQ 主动消息发送记录，说明配置曾经连通；当前真实 E2E 需要先启动 NapCat 并完成 QQ 登录。

- 2026-06-08 20:23 重新启动 NapCat 后复检：
  - `scripts/start-qq.ps1 -WaitSeconds 45` 已成功拉起 NapCat / QQ。
  - NapCat 相关进程数为 `5`。
  - OneBot `OK`，登录用户为 `广袤 (3321802943)`。
  - 预检脚本 `readyForManualE2E=True`。
  - 日志脱敏检查通过：JSON 输出中未发现原始 `token=...`、`WebUi Token: ...` 或 `Bearer ...`。
  - 真实消息 E2E 的下一步是让测试联系人给机器人发送私聊文本，再核对 `[QQ] Queued message` 与 `[QQ] Sent text`。

### QQ / OneBot 在线 E2E 日志证据脚本

- 新增只读脚本：[check-qq-e2e-evidence.ps1](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/scripts/check-qq-e2e-evidence.ps1>)。
- 脚本只读本机日志，不发消息、不调用 OneBot 写接口、不修改配置。
- 支持普通输出与 `-Json` 输出，输出前会脱敏 `token=...`、`WebUi Token: ...` 和 `Bearer ...`。
- 检查项：
  - `private_text_inbound`：是否出现 `[QQ] Queued message contact=qq:private:...`。
  - `text_outbound`：是否出现 `[QQ] Sent text contact=qq:...`。
  - `voice_input`：语音输入下载 / ASR 成功或失败降级信号。
  - `voice_output`：TTS / OneBot record 发送成功或失败降级信号。
  - `image_or_sticker_input`：图片 / 表情包媒体链路或文本占位降级信号。
  - `sticker_output`：主动表情包发送或失败降级信号。
  - `proactive_qq`：QQ 主动消息发送信号。
- 支持 baseline 模式，测试前记录各日志文件当前行数，测试后只分析新增行：

```powershell
cd F:\Code\Mirrai
powershell -ExecutionPolicy Bypass -File scripts/check-qq-e2e-evidence.ps1 -CreateBaselinePath F:\.mirrai-local\Mirrai\logs\qq-e2e-baseline.json
powershell -ExecutionPolicy Bypass -File scripts/check-qq-e2e-evidence.ps1 -BaselinePath F:\.mirrai-local\Mirrai\logs\qq-e2e-baseline.json
```

- 2026-06-08 21:13 本机验证：
  - 普通输出可读。
  - JSON 输出包含 7 个检查项。
  - token 脱敏检查通过。
  - 刚创建 baseline 后复查，新增日志为 0，所有检查项为 `MISSING`，符合“等待真实测试联系人发消息”的状态。

### QQ webhook 入口 smoke 脚本

- 新增低风险 smoke 脚本：[check-qq-webhook-smoke.ps1](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/scripts/check-qq-webhook-smoke.ps1>)。
- 脚本从本机运行目录 [F:/Code/Mirrai](<F:/Code/Mirrai>) 的 `.env` 读取 `QQ_ONEBOT_WEBHOOK_SECRET`，但只展示是否配置，不打印真实密钥。
- 脚本向 Mirrai 本机 `/api/qq/onebot/event` 投递一条 `self_id == user_id` 的自消息事件。
- 预期响应：
  - HTTP 请求成功。
  - `status=ok`。
  - `handled=false`。
  - `reason=ignored_self_message`。
- 这能证明 Mirrai webhook 路由、token 鉴权、JSON body 解析和 QQ handler 入口可用，但不能替代真实 NapCat 上报和测试联系人消息。
- 2026-06-08 21:47 本机验证：
  - `Passed=True`。
  - `HTTP OK=True`。
  - `Response reason=ignored_self_message`。
  - 精确检查确认真实 `QQ_ONEBOT_WEBHOOK_SECRET` 未出现在脚本输出里。

### 运行态导出类型漏项修复

- `corepack pnpm run check` 发现 [db.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/db.ts>) 中 `exportUserData` 已导出 `personaRuntimeStates`，但 `UserDataExportRows` 类型未声明同名字段。
- 已补齐 `personaRuntimeStates?: unknown[]`，保持运行态拆分后的账户导出类型与实际 payload 一致。

## 验证结果

已先同步源码到本机运行目录：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/sync-local-worktree.ps1
```

在本机运行目录 `F:/Code/Mirrai` 通过类型检查：

```powershell
corepack pnpm run check
```

结果：`tsc --noEmit` 通过。

在本机运行目录 `F:/Code/Mirrai` 通过 QQ handler focused 测试：

```powershell
corepack pnpm exec vitest run server/qq/message-handler.test.ts
```

结果：1 个测试文件、16 个测试全部通过。

在本机运行目录 `F:/Code/Mirrai` 通过阶段 3 focused 测试：

```powershell
corepack pnpm exec vitest run server/qq/message-handler.test.ts server/voice/voice-reply-policy.test.ts server/voice/audio-normalizer.test.ts server/voice/zhipu-asr.test.ts server/stickers/sticker-policy.test.ts server/stickers/sticker-selector.test.ts server/social/persona-text-chat.test.ts server/wechat/proactive-scheduler.test.ts
```

结果：8 个测试文件、55 个测试全部通过。

2026-06-08 补充验证 QQ / 语音 / 表情 focused 测试：

```powershell
corepack pnpm exec vitest run server/qq/message-handler.test.ts server/qq/persona-bridge.test.ts server/voice/voice-reply-policy.test.ts server/voice/audio-normalizer.test.ts server/voice/zhipu-asr.test.ts server/stickers/sticker-policy.test.ts server/stickers/sticker-selector.test.ts
```

结果：7 个测试文件、46 个测试全部通过。

## 注意事项

- 本轮已启动真实 QQ / NapCat，并确认 OneBot 在线；但尚未由真实测试联系人发送新消息，因此还没有完成外部收发端到端验证。
- 当前真实在线 E2E 的剩余前置是测试联系人发起私聊文本 / 语音 / 图片等消息，不是 focused 测试失败，也不是 NapCat 离线。
- 本轮没有修改数据库 schema。
- 同步盘源码目录曾因一次误在源码目录运行 `corepack pnpm exec vitest ...` 重新出现 `node_modules/`；已确认路径后删除。当前同步盘无 `node_modules`、无 `.env`。
- `package.json` / `pnpm-lock.yaml` 当前仍有既有脏改动，本轮未回退。

## 下一步建议

1. 如要做真实端到端验证，先确认 NapCat / OneBot 已登录，再用小号或测试联系人跑私聊文本、语音、图片、表情包四条链路。
2. 在线 E2E 时重点核对真实 NapCat 日志与 handler 日志是否能串起同一条 messageId / contactId。
