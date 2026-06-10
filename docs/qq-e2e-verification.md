# QQ / NapCat 端到端验证流程

> 用途：在 mock 测试之外，验证 Mirrai 能通过真实 NapCat / OneBot 收到 QQ 消息、进入共享社交 runtime，并把文字、语音、图片、表情包和主动消息稳定发回 QQ。  
> 约束：同步盘源码目录只保存源码；运行、日志、NapCat 状态、上传文件、语音缓存都留在本机目录。

## 0. 本机路径

- 源码同步目录：[Mirrai](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai>)
- 本机运行目录：[Mirrai](<F:/Code/Mirrai>)
- 本机运行数据目录：[Mirrai](<F:/.mirrai-local/Mirrai>)
- NapCat 默认目录：[onekey-v4.18.1](<F:/.mirrai-local/Mirrai/tools/napcat/onekey-v4.18.1>)
- 本机日志目录：[logs](<F:/.mirrai-local/Mirrai/logs>)

不要把 `.env`、NapCat 登录态、QQ 本地状态、日志、数据库、上传文件或语音缓存复制回同步盘源码目录。

## 1. 环境预检

在同步盘源码目录执行：

```powershell
git status --short --branch
powershell -ExecutionPolicy Bypass -File scripts/sync-local-worktree.ps1
```

在本机运行目录确认 `.env` 存在：

```powershell
Test-Path -LiteralPath F:\Code\Mirrai\.env
```

也可以直接运行只读预检脚本，一次性检查本机 `.env`、Mirrai Web、NapCat 进程、OneBot 登录接口和最近 QQ 日志信号：

```powershell
cd F:\Code\Mirrai
powershell -ExecutionPolicy Bypass -File scripts/check-qq-e2e-readiness.ps1
```

如需给后续自动化或排障记录使用 JSON：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/check-qq-e2e-readiness.ps1 -Json
```

这个脚本不会启动或停止任何服务，也不会打印 `QQ_ONEBOT_ACCESS_TOKEN` 或 `QQ_ONEBOT_WEBHOOK_SECRET` 的真实值；最近日志信号里的 `token=...`、`WebUi Token: ...` 和 `Bearer ...` 也会先脱敏。

真实消息测试前，建议先创建一份日志 baseline：

```powershell
cd F:\Code\Mirrai
powershell -ExecutionPolicy Bypass -File scripts/check-qq-e2e-evidence.ps1 -CreateBaselinePath F:\.mirrai-local\Mirrai\logs\qq-e2e-baseline.json
```

测试联系人发送 QQ 消息后，只看 baseline 之后新增的日志证据：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/check-qq-e2e-evidence.ps1 -BaselinePath F:\.mirrai-local\Mirrai\logs\qq-e2e-baseline.json
```

这个证据脚本同样只读日志、不发消息、不改配置，并会对日志里的 token 做脱敏。由于当前 dev 日志不是每行都有稳定时间戳，优先使用 `-CreateBaselinePath` / `-BaselinePath`；`-Since` 只用于排除整个日志文件早于测试时间的情况。

如果要先确认 Mirrai webhook 入口、鉴权和 JSON 解析是否正常，可以跑低风险 smoke：

```powershell
cd F:\Code\Mirrai
powershell -ExecutionPolicy Bypass -File scripts/check-qq-webhook-smoke.ps1
```

这个 smoke 会向 `/api/qq/onebot/event` 投递一条 `self_id == user_id` 的自消息事件，预期响应为 `handled=false, reason=ignored_self_message`。它不会调用 OneBot 发送接口，也不会触发 persona runtime；它只能证明 Mirrai webhook 入口可用，不能替代真实 NapCat 上报和测试联系人消息。

本机 `.env` 至少需要：

```env
QQ_ENABLED=true
QQ_ONEBOT_BASE_URL=http://127.0.0.1:3001
QQ_ONEBOT_ACCESS_TOKEN=
QQ_ONEBOT_WEBHOOK_SECRET=
QQ_QUICK_LOGIN_UIN=
QQ_ALLOW_GROUPS=false
QQ_AUTO_BIND_SINGLE_READY_PERSONA=true
```

如果要验证 QQ 语音输出，先选一种 TTS：

```env
QQ_VOICE_REPLY_ENABLED=true
QQ_VOICE_REPLY_MODE=smart
QQ_TTS_PROVIDER=windows-sapi
QQ_TTS_FALLBACK_PROVIDER=none
```

如果使用 VoxCPM，按 [voxcpm-qq-voice.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/docs/voxcpm-qq-voice.md>) 准备本机服务；如果使用 MiniMax，按 [minimax-qq-voice.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/docs/minimax-qq-voice.md>) 准备密钥和 voice id。

## 2. 启动与状态检查

只启动网页和 QQ 文本链路时：

```powershell
cd F:\Code\Mirrai
powershell -ExecutionPolicy Bypass -File scripts/start-all.ps1 -SkipVoxCPM
```

只查看状态，不启动或重启：

```powershell
cd F:\Code\Mirrai
powershell -ExecutionPolicy Bypass -File scripts/check-qq-e2e-readiness.ps1
powershell -ExecutionPolicy Bypass -File scripts/status-mirrai.ps1
powershell -ExecutionPolicy Bypass -File scripts/status-qq.ps1
```

期望：

- Mirrai `Web: OK (200)`。
- QQ/NapCat `Process: RUNNING`。
- OneBot `OK`，并显示登录昵称或 QQ 号。

如果 `OneBot: NOT RESPONDING`：

- 运行 `scripts/start-qq.ps1`。
- 如果弹出 QQ / NapCat 登录窗口，先完成登录。
- 再运行 `scripts/status-qq.ps1`，直到 OneBot 显示 `OK`。

如果启用了 `QQ_ONEBOT_ACCESS_TOKEN`，状态脚本会自动从本机 `.env` 读取 token；如果仍鉴权失败，先检查 NapCat OneBot HTTP API token 是否与 `.env` 一致。

## 3. NapCat 配置检查

NapCat 需要启用 OneBot HTTP API，并把 HTTP POST 事件上报到 Mirrai：

```text
http://localhost:3000/api/qq/onebot/event
```

如果配置了 `QQ_ONEBOT_WEBHOOK_SECRET`，上报地址使用：

```text
http://localhost:3000/api/qq/onebot/event?token=你的 QQ_ONEBOT_WEBHOOK_SECRET
```

也可以使用请求头：

```text
x-mirrai-token: 你的 QQ_ONEBOT_WEBHOOK_SECRET
```

Mirrai 的 QQ 设置页会显示当前 webhook URL、OneBot base URL、启用状态和最近错误。

## 4. 联系人和角色绑定

1. 打开 [http://localhost:3000/settings](http://localhost:3000/settings)。
2. 进入 QQ 标签。
3. 确认至少有一个 `ready` 分身。
4. 让测试联系人先给机器人 QQ 发一条私聊。
5. 在“最近 QQ 联系人”中绑定到目标分身。

如果当前账号只有一个 `ready` 分身，并且 `.env` 设置 `QQ_AUTO_BIND_SINGLE_READY_PERSONA=true`，首次收到 QQ 私聊时会自动绑定。

群聊默认不验证。只有明确要测群聊时，才把 `.env` 改为：

```env
QQ_ALLOW_GROUPS=true
QQ_VOICE_REPLY_ALLOW_GROUPS=true
QQ_STICKER_REPLY_ALLOW_GROUPS=true
```

验证完群聊后改回 `false`，避免机器人在群里误回复。

## 5. 手动验证矩阵

### 私聊文本

操作：测试联系人发送一句普通私聊，例如“你在吗”。

期望：

- Mirrai 日志出现 `[QQ] Queued message contact=qq:private:...`。
- 角色进入共享 social runtime。
- QQ 收到自然文字回复。
- 消息记录的 channel 为 `qq`。

### 群聊默认跳过

操作：在 `QQ_ALLOW_GROUPS=false` 时，让群里发普通消息。

期望：

- Mirrai 返回或记录 `group_disabled`。
- 不调用角色 runtime。
- 不向群聊发送回复。

### 语音输入

操作：测试联系人给机器人发一条 QQ 语音。

期望成功链路：

- 日志出现 `voice_in_received`。
- 下载成功时出现 `voice_in_download_success`。
- ASR 成功后，转写文本进入共享 runtime。
- 机器人返回文字或按策略返回语音。

期望降级链路：

- 下载失败：`voice_in_download_failed`，自然提示“没听清”。
- 转码失败：`voice_in_normalize_failed_fallback_text`，退回文字提示。
- ASR 失败：`voice_asr_failed_fallback_text`，退回文字提示。
- 任一步失败都不导致 Mirrai 进程退出。

### 语音输出

操作：测试联系人明确要求“用语音回我”或“你说出来”。

期望：

- 日志出现 `voice_reply_policy_checked`。
- TTS 开始时出现 `voice_tts_start`。
- 成功发送 record 时出现 `voice_send_success`。
- 如果 TTS 或发送失败，出现 `voice_tts_failed` 或 `voice_send_failed_fallback_text`，并退回文字。

### 图片或表情包输入

操作：测试联系人发送图片、QQ 表情包或带图片的文字。

期望：

- 可读取媒体时进入 media runtime。
- 无法读取媒体但有文字时，回退到 `[图片]` / `[表情]` 文本占位。
- 视觉模型未配置或失败时不影响主回复。

### 主动表情包

操作：测试联系人发调侃、玩笑或表情包，触发表情包策略。

期望：

- 机器人先发送主文字回复。
- 策略命中时出现 `sticker_policy_checked`、`sticker_intent_detected`、`sticker_selected`。
- 文件缺失或 OneBot 发送失败时出现 `sticker_not_found` 或 `sticker_send_failed_fallback_text`，主文字回复不受影响。

### 主动消息

操作：让已绑定 QQ 的分身到达一个固定主动消息窗口，或在本机开发中临时把 schedule 调到接近当前时间。

期望：

- 日志出现 `[Proactive] Sent scheduled qq message`。
- QQ 收到主动消息。
- 消息记录 channel 为 `qq`。
- 同一条主动消息不同时重复发到微信。

## 6. 日志定位

常用日志：

```powershell
Get-Content -Path F:\.mirrai-local\Mirrai\logs\dev.out.log -Tail 120
Get-Content -Path F:\.mirrai-local\Mirrai\logs\dev.err.log -Tail 120
Get-Content -Path F:\.mirrai-local\Mirrai\logs\qq-napcat.out.log -Tail 120
Get-Content -Path F:\.mirrai-local\Mirrai\logs\qq-napcat.err.log -Tail 120
```

重点关键词：

- `qq.disabled`
- `qq.onebot_auth_failed`
- `qq.onebot_unreachable`
- `[QQ] Queued message`
- `[QQ] Sent text`
- `[QQ] Handling image message`
- `voice_in_download_failed`
- `voice_in_normalize_failed_fallback_text`
- `voice_asr_failed_fallback_text`
- `voice_tts_failed`
- `voice_send_failed_fallback_text`
- `sticker_send_failed_fallback_text`
- `[Proactive] Sent scheduled qq message`

也可以用证据脚本自动汇总这些信号：

```powershell
cd F:\Code\Mirrai
powershell -ExecutionPolicy Bypass -File scripts/check-qq-e2e-evidence.ps1
powershell -ExecutionPolicy Bypass -File scripts/check-qq-e2e-evidence.ps1 -Json
```

首轮私聊文本 E2E 至少需要：

- `private_text_inbound` 为 `OK`，对应 `[QQ] Queued message contact=qq:private:...`。
- `text_outbound` 为 `OK`，对应 `[QQ] Sent text contact=qq:...`。
- 如果使用 baseline，则这两项应出现在 baseline 之后的新增日志里。

## 7. 清理

验证结束后：

- 在设置页解除临时 QQ 联系人绑定。
- 删除测试角色、临时消息或测试账号数据。
- 如果不继续运行 Mirrai：

```powershell
cd F:\Code\Mirrai
powershell -ExecutionPolicy Bypass -File scripts/stop-mirrai.ps1
```

- QQ/NapCat 默认可以保留登录态；只有明确要退出或重登时才手动停止或重启 NapCat。
- 确认同步盘源码目录仍没有 `.env`、`node_modules`、`dist`、`.vite`、`uploads`、日志或数据库文件。

## 8. 当前已知状态记录

2026-06-08 首次本机只读预检：

- [F:/Code/Mirrai](<F:/Code/Mirrai>) 中 `.env` 存在。
- NapCat 默认目录存在。
- Mirrai 本机服务正在运行，`Web: OK (200)`。
- QQ/NapCat 当前 `Process: STOPPED`，OneBot `NOT RESPONDING`。
- [check-qq-e2e-readiness.ps1](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/scripts/check-qq-e2e-readiness.ps1>) 已可用于后续真实 E2E 前的只读状态检查。
- 本机日志显示今日早些时候曾成功发送 QQ 主动消息到 `qq:private:1274568850`，说明配置曾经连通；继续真实 E2E 需要先让 NapCat 重新在线，并让测试联系人发送私聊。

2026-06-08 20:23 复检：

- 已从 [F:/Code/Mirrai](<F:/Code/Mirrai>) 运行 `scripts/start-qq.ps1 -WaitSeconds 45`。
- QQ/NapCat 当前 `Process: RUNNING`，相关进程数为 `5`。
- OneBot 当前 `OK`，登录用户为 `广袤 (3321802943)`。
- [check-qq-e2e-readiness.ps1](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/scripts/check-qq-e2e-readiness.ps1>) 当前报告 `Ready: True`。
- 真实 E2E 下一步：让测试联系人给机器人 QQ 发送私聊文本，核对 Mirrai 日志是否出现 `[QQ] Queued message` 和 `[QQ] Sent text`；随后继续验证语音、图片 / 表情包和主动消息。

2026-06-08 21:13 证据脚本验证：

- 新增 [check-qq-e2e-evidence.ps1](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/scripts/check-qq-e2e-evidence.ps1>)。
- 已验证普通输出、JSON 输出、日志 token 脱敏和 baseline 模式。
- 当前从 baseline 后新增日志为 0，因此 `private_text_inbound` 和 `text_outbound` 仍为 `MISSING`；等待测试联系人发起真实私聊文本后复跑。

2026-06-08 21:47 webhook smoke 验证：

- 新增 [check-qq-webhook-smoke.ps1](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/scripts/check-qq-webhook-smoke.ps1>)。
- 本机响应 `Passed: True`，`HTTP OK: True`，`Response reason: ignored_self_message`。
- 精确检查确认真实 `QQ_ONEBOT_WEBHOOK_SECRET` 未出现在脚本输出里。
- 这只证明 Mirrai webhook 入口、token 鉴权、JSON body 解析和 QQ handler 入口可用；真实 E2E 仍需要测试联系人发消息。
