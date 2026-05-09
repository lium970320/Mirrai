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

## 第一版限制

- 第一版只处理文字、图片/表情占位、语音/视频/文件占位，不做 QQ 图片理解和语音转写。
- 群聊默认关闭，需显式设置 `QQ_ALLOW_GROUPS=true`。
- 为了避免立即迁移 Neon 数据库，QQ 联系人暂时复用现有社交绑定表，并用 `qq:` 前缀区分，不影响微信联系人。
