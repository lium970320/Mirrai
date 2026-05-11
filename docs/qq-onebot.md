# QQ OneBot 接入说明

Mirrai 第一版 QQ 端走 OneBot HTTP，推荐配合 NapCatQQ 使用。微信端仍保留，QQ 端只是新增一条入口。

## 本机 `.env`

只在本机运行副本里改 `.env`，例如 `F:/Code/Mirrai/.env`，不要把密钥同步进 Google Drive 源码目录。

```env
QQ_ENABLED=true
QQ_ONEBOT_BASE_URL=http://127.0.0.1:3001
QQ_ONEBOT_ACCESS_TOKEN=
QQ_ONEBOT_WEBHOOK_SECRET=
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

## 第一版限制

- 第一版已支持 QQ 文字、普通图片、部分表情包/GIF 的视觉理解；语音/视频/文件仍只作为占位，不做 QQ 语音转写。
- 群聊默认关闭，需显式设置 `QQ_ALLOW_GROUPS=true`。
- 为了避免立即迁移 Neon 数据库，QQ 消息暂时仍使用现有 `web` 渠道保存；QQ 联系人用 `qq:` 前缀区分，不影响微信联系人。
- 主动消息支持 QQ：如果人物存在 QQ 绑定，固定时间主动消息和随机日常存在感消息会优先发到 QQ；只有没有 QQ 绑定时才回退到微信，避免同一条主动消息在两个平台重复发送。
