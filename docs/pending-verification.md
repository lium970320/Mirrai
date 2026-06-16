# 待验证清单（2026-06-16 审阅后修复批次）

> 这批改动在 Google Drive 同步盘**源码副本**上完成，无法在该机器运行 `tsc`/`vitest`（无 `node_modules`）。
> 需把源码同步到运行机 **`F:/Code/Mirrai`** 后按本清单验证。**验证通过前不要 `git push`。**

当前 `main` 比 `origin/main` 领先约 **28 个本地提交**：收口 10 + P0 修复 7 + P1/P2 修复与清理 11。

---

## 一、必跑：类型检查 + 测试

```powershell
# 先把同步盘源码镜像到运行机（按你平时的同步方式）
cd F:\Code\Mirrai

# 1) 全量类型检查——覆盖本批次所有服务端改动，最关键的一道
corepack pnpm run check

# 2) 全量测试（含本批次新增/修改的测试）
corepack pnpm test
```

如果只想跑本批次直接相关的测试：

```powershell
corepack pnpm exec vitest run `
  server/_core/password.test.ts `
  server/persona.test.ts `
  server/social/memory-governance.test.ts `
  server/social/roleplay-channel.test.ts `
  server/social/daily-memory.test.ts `
  server/social/persona-text-chat.test.ts `
  server/social/incoming-message-batcher.test.ts `
  server/social/proactive-delivery.test.ts `
  server/qq/message-handler.test.ts `
  server/qq/persona-bridge.test.ts
```

---

## 二、必做：手动确认登录 / 注册（认证改了关键路径）

认证从单轮 sha256 升级到 scrypt（带旧哈希惰性迁移），这是本批次唯一动到登录主链路的地方，务必手动过一遍：

- **注册新账号** → 成功；DB `users.passwordHash` 应以 `scrypt$` 开头。
- **老账号登录** → 成功（旧 `salt:hash` 校验通过后自动重写为 `scrypt$...`；再次查 DB 应已变为 scrypt 格式）。
- **错误密码** → 返回 401。
- **连续失败很多次（>20 次/15 分钟）** → 返回 429（限流生效）。
- **生产模式校验**：`NODE_ENV=production` 且未设 `JWT_SECRET`（或仍是默认 `dev-secret-change-me` / 短于 32 位）时，服务**启动应直接报错**并退出（fail-fast）。开发模式不受影响。

---

## 三、按改动区域的验证点

| 区域 | 提交 | 怎么确认 |
|------|------|---------|
| 安全三连 IDOR | `14fadb0` + 测试 `2e1e212` | `pnpm exec vitest run server/persona.test.ts` 通过；越权用例（跨用户删/读场景、技能任务）应被拒 |
| 认证加固 | `ee907da` | `pnpm exec vitest run server/_core/password.test.ts` 通过 + 第二节手动登录 |
| 前端整页崩溃 | `0b20a0c` | 大厅「记忆星河」页：某分身从分析中变就绪时不应跳错误界面 |
| 性格分析卡死 | `34d1b71` | 制造 DB 不可用场景触发分析，persona 状态应落到 `error` 可重试，而非永久 `analyzing` |
| 记忆冲突误判 | `52f0459` | `vitest run server/social/memory-governance.test.ts`（含新负例）通过 |
| 每日记忆去重 | `77030ec` | `vitest run server/social/daily-memory.test.ts` 通过；长期跑不应堆积近义重复记忆 |
| 幽灵助手消息 | `10688c1` | QQ 连发多条消息：被丢弃的旧回复不应残留在历史/下轮上下文 |
| Roleplay 并发/沉默 | `e31a073` | `vitest run server/social/roleplay-channel.test.ts` 通过；开两个标签页同时点「推进一轮」不应双发；某成员持续沉默时轮转应轮到下一位 |
| QQ webhook / 语音冷却 | `25b1aa6` | webhook 鉴权仍正常（`scripts/check-qq-webhook-smoke.ps1`）；长期运行内存不再随联系人增长 |
| TTS 原子写入 | `989b35c` | 并发/中断生成语音不再缓存半成品 WAV；坏/空文件不被当缓存命中 |
| 前端文案 | `89f66b9` | Landing/大厅不再出现「微信」营销文案（历史频道徽章、上传素材说明里的微信是合理保留）|
| WeChat 残留清理 | `c9c4724` `5058b5a` | **`pnpm run check` 必须通过**（确认 sayWeChatReply→saySocialReply 等重命名无遗漏断链）；批处理/发送/QQ 自动绑定行为不变；`SOCIAL_REPLY_BATCH_*` 取代旧 `WECHAT_REPLY_BATCH_*` 环境变量 |
| sticker/intimacy 去重 | `399f76a` | `vitest run server/stickers/sticker-policy.test.ts` 通过；表情包对「崩了/错误/封控」类严肃话题现在也会屏蔽 |

---

## 四、可选：真实环境验证（运行机有 NapCat 时）

- QQ 私聊主链路：文本 / 语音输入输出 / 图片 / 表情包 / 主动消息（参见 [docs/qq-e2e-verification.md](qq-e2e-verification.md)）。
- Roleplay：两个以上就绪分身建频道，轮流发言 + 沉默轮转 + 严格省额度跳过。

---

## 五、本批次**未做**（需你决定或后续专项）

- **通用化重构（最大项，需你拍板）**：记忆召回触发词、原著专有词表、用户性别/代词目前**硬编码到单一人物/单一原著**（`server/db.ts` 的 `extractPersonaSourceSearchTerms`、`server/social/memory-recall.ts` 的代词覆盖等）。第二个分身或非男性用户会代词出错、召回失灵。改成 **persona 级配置**才能兑现「上传任意素材重建分身」。配置该长什么样需要你定方向，再动手。
- **前端最小测试基线（被阻塞）**：client 零测试，但补测要新增 `jsdom` / `@testing-library/react` 等依赖，须先 `pnpm install` 更新 `pnpm-lock.yaml`——同步盘这台跑不了 install。留到运行机侧或一次能装依赖的会话做。
- **技能蒸馏 Node↔Python 内容传递**：当前 Python 段产出空壳技能（`pipeline.ts:101` 只传了 name/character）。CLI 契约已确认：`skill_writer.py` 的 `--meta`/`--work`/`--persona` 接收**内容文件路径**。修法是把蒸馏出的 work/persona/meta 落临时文件、按这三个参数传入，再把返回的 skill_dir 写回 `skill_jobs.generatedSkillPath`。非阻塞（主 personaData 已入库），留到能验证时实现。
- **拆分超红线热点函数**（`handleSocialPersonaTextChatDetailed` 284 行、`handleQqOneBotEvent` 123 行等）：纯重构、无测试网，风险高，延后。
- **Drizzle 迁移 journal 重建**：审阅核验为「有意决定」（`ensure*Table` + `db:check` 闭环），非阻塞，延后；可顺手删重复的 `drizzle/0000_cheerful_darwin.sql`。
- ~~**文档微信残留**（`docs/qq-onebot.md` 微信回退叙述）~~ 已修正；`docs/*` 里失效的 `F:/Google Drive` 源码链接仍待整理（低优先）。
- **保留项说明**：runtime 平台/通道枚举里的 `wechat` 值、`wechat_bindings`/`wechat_bot_state` 表、历史消息的「微信」展示**有意保留**——它们承载历史数据与复用表（QQ 绑定以 `qq:` 前缀存于 `wechat_bindings`），不是残留。彻底移除运行时 `wechat` 平台分支会牵动 contract 与多个平台测试，留作单独的有验证的改动。
- **其他 P2**：~~sticker 严肃话题正则去重~~（已做 `399f76a`）、~~`INTIMACY_LEVELS` 副本复用~~（已做 `399f76a`）。剩余两项：运维脚本从 `.env` 读取实际 `PORT`（涉及多个 ps1 + 端口冲突策略，建议讨论后做）、sticker selector 改为「发送成功后再记账」以免去重池被未发出的选择污染。

---

## 验证通过后

确认 `pnpm run check` 与 `pnpm test` 全绿、登录手动验证无误后，即可 `git push`（或按你的流程合并）。如有红字，把输出贴回来定位修复。
