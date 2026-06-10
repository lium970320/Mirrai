# QQ OneBot 接入说明

Mirrai 第一版 QQ 端走 OneBot HTTP，推荐配合 NapCatQQ 使用。微信端仍保留，QQ 端只是新增一条入口。

真实端到端验证流程见 [qq-e2e-verification.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/docs/qq-e2e-verification.md>)。

## 本机 `.env`

只在本机运行副本里改 `.env`，例如 `F:/Code/Mirrai/.env`，不要把密钥同步进 Google Drive 源码目录。

```env
QQ_ENABLED=true
QQ_ONEBOT_BASE_URL=http://127.0.0.1:3001
QQ_ONEBOT_ACCESS_TOKEN=
QQ_ONEBOT_WEBHOOK_SECRET=
QQ_QUICK_LOGIN_UIN=
QQ_ALLOW_GROUPS=false
QQ_AUTO_BIND_SINGLE_READY_PERSONA=true
```

## NapCatQQ 侧配置

1. 启用 OneBot HTTP API，地址保持和 `QQ_ONEBOT_BASE_URL` 一致。
2. 配置 HTTP POST 事件上报到 Mirrai：

```text
http://localhost:3000/api/qq/onebot/event
```

如果设置了 `QQ_ONEBOT_WEBHOOK_SECRET`，上报地址改成：

```text
http://localhost:3000/api/qq/onebot/event?token=你的 QQ_ONEBOT_WEBHOOK_SECRET
```

如果 NapCat 里保存了多个 QQ 的快速登录记录，建议在本机 `.env` 里设置 `QQ_QUICK_LOGIN_UIN`。一键启动脚本会优先登录这个 QQ；如果为空，会尝试从 NapCat 的 `onebot11_*.json` 配置文件推断。

## 绑定角色

1. 重启 Mirrai。
2. 打开设置页的 `QQ` 标签。
3. 让目标 QQ 先发一条私聊消息。
4. 在“最近 QQ 联系人”里把该联系人绑定到一个已分析完成的分身。

如果当前账号只有一个 `ready` 分身，并且 `QQ_AUTO_BIND_SINGLE_READY_PERSONA=true`，第一次收到 QQ 消息时会自动绑定。

## 图片识别

QQ 端会识别 OneBot `image` 消息段，优先下载段里的 `url`，如果段里提供的是 `base64://` 或本机绝对路径，也会尝试读取。下载成功后会复用微信端同一套视觉模型配置：

```env
VISION_API_KEY=
VISION_BASE_URL=
VISION_MODEL=
```

如果图片下载失败、视觉模型未配置或模型识别失败，QQ 端会自动退回普通 `[图片]` 文本流程，不会中断主对话。

## 当前能力与限制

- 当前已支持 QQ 文字、普通图片、部分表情包/GIF 的视觉理解，以及 QQ `record` 语音输入转写。
- QQ 语音输入会尝试通过 OneBot 获取文件、归一化音频并交给 ASR；下载、转码或 ASR 任一步失败时会自然退回文字提示。
- QQ 语音输出支持按策略调用 Windows SAPI、VoxCPM 或 MiniMax；TTS 或 OneBot 发送失败时退回文字，不中断主对话。
- 群聊默认关闭，需显式设置 `QQ_ALLOW_GROUPS=true`。
- QQ 新消息和主动消息使用 `channel: "qq"` 保存；QQ 联系人用 `qq:` 前缀区分，不影响微信联系人。
- 主动消息支持 QQ：如果人物存在 QQ 绑定，固定时间主动消息和随机日常存在感消息会优先发到 QQ；只有没有 QQ 绑定时才回退到微信，避免同一条主动消息在两个平台重复发送。
- QQ/微信社交端会遵守角色日程：王芃泽睡眠时段收到普通消息默认不立即回复；明确叫醒、急事、难受或需要陪伴的消息仍会回复。被叫醒后会进入约 20 分钟的半睡半醒临时状态，这段时间继续发消息会继续回复，而不是下一条又重新静默。
- QQ/微信文本消息会短时间合并处理。用户连续发多条时只生成一轮综合回复；如果生成期间又收到新消息，旧回复会被丢弃，等待下一轮结合所有未回应内容重新组织，避免“积压消息突然爆发式补答”。
- 当前不做 QQ 语音电话、自动接听、视频和文件内容解析。
