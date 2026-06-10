# Mirrai 阶段 5 UI 与诊断体验整理记录

记录时间：2026-06-08  
对应计划：[MIRRAI_WORK_PLAN.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_WORK_PLAN.md>)

## 本轮完成

### 诊断面板运行事件可扫描化

- 更新诊断面板：[PersonaStatePanel.tsx](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/client/src/components/PersonaStatePanel.tsx>)
  - 在总览指标下新增“最近运行事件”薄条。
  - 直接展示最近一次 runtime diagnostics 的 `platform`、`channel`、`mode`、`trigger`、`outputMode` 和 `delivery`。
  - 输入 / 回复预览保持单行截断，避免移动端撑宽。
  - 在 Planner 详细区新增两组字段：
    - `Runtime 路由`：平台、消息通道、运行模式、触发来源、输出倾向、媒体类型 / 地址。
    - `投递与触发`：投递结果、投递平台、投递通道、定时槽位、环境事件、时段。
  - 补充 `media`、`voice`、`teasing`、`technical` 等 intent label，避免面板把常见 planner intent 直接裸显成英文。
- 更新文本 runtime diagnostics：[persona-text-chat.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/persona-text-chat.ts>)
  - 文本回复 diagnostics 现在显式写入 `channel` 和 `mode: "reply"`。
  - 与媒体回复、主动消息 diagnostics 对齐，前端不需要猜测消息通道或运行模式。
- 更新文本 runtime 集成式测试：[persona-text-runtime-platform.test.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/persona-text-runtime-platform.test.ts>)
  - 断言 Web / WeChat / QQ 文本回复的 runtime diagnostics 都包含 `platform`、`channel` 和 `mode`。

### Settings 运维诊断页

- 扩展只读运维诊断数据：[output-diagnostics.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/output-diagnostics.ts>)
  - 新增 `getOperationsDiagnostics`，统一输出 QQ / 微信、语音、表情包、主动消息、LLM provider、数据库模式和 runtime 文件路径。
  - 新增 `getDatabaseRuntimeDiagnostics`，把 `DATABASE_URL` 归类为 `local`、`neon`、`remote`、`unconfigured` 或 `invalid`，只返回 host、database、port 和推荐运行命令，不返回用户名、密码或完整连接串。
  - LLM 诊断只展示 provider 名称、模型、endpoint origin 和 `configured` 布尔状态；不返回 API key、access token、webhook secret。
- 新增受保护接口：[systemRouter.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/_core/systemRouter.ts>)
  - `system.operationsDiagnostics` 基于当前用户的分身列表汇总主动消息配置。
  - 合并运行时 LLM 用量快照、QQ 实时状态和微信实时状态。
- 更新设置页：[Settings.tsx](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/client/src/pages/Settings.tsx>)
  - 侧栏新增“运维诊断”页签。
  - 页面分区包括：
    - 运行与数据库
    - LLM 路由
    - 平台接入
    - Runtime 收敛
    - 语音
    - 表情包
    - 主动消息
  - 长路径、长 URL、模型名和错误信息使用 `break-all` / `break-words`，避免移动端撑宽。
- 更新聚焦测试：[output-diagnostics.test.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/output-diagnostics.test.ts>)
  - 验证数据库模式识别。
  - 验证运维诊断聚合主动消息、LLM、平台 runtime。
  - 验证不泄露数据库密码、API key、access token 或 webhook secret 原始字段。

### 聊天页运行诊断入口命名统一

- 更新聊天页：[Chat.tsx](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/client/src/pages/Chat.tsx>)
  - 顶部诊断按钮 `title` 从“内心诊断”改为“运行诊断”。
  - 顶部诊断按钮增加 `aria-label="打开运行诊断"`。
  - 更多菜单里的“内心状态诊断”改为“运行诊断”。
  - 入口图标从 `Brain` 换为 `Activity`，和运维 / 运行状态语义对齐。
- 更新诊断面板：[PersonaStatePanel.tsx](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/client/src/components/PersonaStatePanel.tsx>)
  - 面板标题仍为“角色运行诊断”，标题图标改为 `Activity`。
  - “规划与思考诊断”改为“规划与反思诊断”。
  - “心声反思 (Reflection)”改为“隐藏反思 (Reflection)”。
  - 空状态提示同步改为“Planner 和隐藏反思结果”。

### 诊断文案与行动建议 polish

- 更新设置页：[Settings.tsx](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/client/src/pages/Settings.tsx>)
  - QQ 实时状态从 `connected`、`error`、`disabled` 映射为 `已连接`、`连接异常`、`未启用`。
  - 微信实时状态从 `logged_in`、`starting`、`scanning`、`stopped`、`error` 映射为 `已登录`、`启动中`、`等待扫码`、`未启动`、`运行异常`。
  - QQ / 微信原始错误保留为“原始错误”，同时新增行动建议框：
    - `NapCat / OneBot 不可访问`
    - `OneBot access token 可能不匹配`
    - `微信 Web 登录已熔断`
    - `微信机器人未启动`
  - Runtime 能力标签改为中文：`文本`、`媒体`、`语音输入`、`语音输出`、`表情包`、`主动消息`、`自动绑定单角色`。
  - 语音模式、TTS provider 和 ASR fallback 改为中文展示，避免 `unknown` 裸显。
- 更新诊断面板：[PersonaStatePanel.tsx](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/client/src/components/PersonaStatePanel.tsx>)
  - 补充 `incoming_message`、输出模式、记忆模式、回复长度、语音模式、TTS provider、LLM purpose 的中文映射。
  - `Channel`、`Mode`、`Trigger` 等运行字段统一显示为 `通道`、`模式`、`触发`。
  - `reflection.replyStrategy` 命中已知回复长度枚举时显示为 `短回复` / `中等回复` / `长回复`，自然语言策略仍原样显示。

## 验证结果

已同步源码到本机运行目录：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/sync-local-worktree.ps1
```

在本机运行目录 `F:/Code/Mirrai` 通过 focused 测试：

```powershell
corepack pnpm exec vitest run server/social/persona-text-runtime-platform.test.ts server/social/persona-media-runtime-platform.test.ts server/wechat/proactive-runtime-generation.test.ts server/social/runtime-request.test.ts
```

结果：4 个测试文件、10 个测试全部通过。

本轮新增运维诊断聚焦测试：

```powershell
corepack pnpm exec vitest run server/social/output-diagnostics.test.ts
```

结果：1 个测试文件、3 个测试全部通过。

随后通过类型检查：

```powershell
corepack pnpm run check
```

结果：`tsc --noEmit` 通过。

补充 polish 后再次同步并验证：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/sync-local-worktree.ps1
corepack pnpm run check
corepack pnpm exec vitest run server/social/output-diagnostics.test.ts
```

结果：`tsc --noEmit` 通过；`server/social/output-diagnostics.test.ts` 1 个测试文件、3 个测试全部通过。

## 浏览器验证

本机服务地址：[http://localhost:3000](http://localhost:3000)

- 使用本机运行数据库创建临时账号 `codex_phase5_ui_test` 和临时角色 `Phase5 诊断测试角色`，注入一条 scheduled proactive diagnostics。
- 桌面视口打开 `/chat/4`，诊断面板可见：
  - `最近运行事件`
  - `平台 QQ`
  - `通道 QQ`
  - `主动消息`
  - `定时触发`
  - `投递 成功 · QQ`
  - `Runtime 路由`
  - `投递与触发`
  - `21:00 -> 21:06`
- 移动视口 `390x844` 打开同一诊断面板：
  - 页面级 `documentElement.scrollWidth === documentElement.clientWidth === 390`。
  - `body.scrollWidth === body.clientWidth === 390`。
  - 诊断侧栏宽约 `374px`，右侧贴齐视口，没有页面级横向溢出。
  - 上述关键字段仍可见。
- 截图接口 `Page.captureScreenshot` 在移动面板上超时；DOM 和布局指标已完成验证。
- 验证后已删除临时测试账号及其角色数据。

### Settings 运维诊断页验证

- 本机服务地址：[http://localhost:3000/settings](http://localhost:3000/settings)
- 使用本机运行数据库创建临时账号 `codex_phase5_ops_1780875336858`，验证后已通过 `deleteUserAccount` 清理，临时 Playwright session 已关闭。
- 桌面视口 `1280x720`：
  - 设置页侧栏可见“运维诊断”页签。
  - 点击后可见以下关键区域：
    - `运行与数据库`
    - `LLM 路由`
    - `平台接入`
    - `Runtime 收敛`
    - `语音`
    - `表情包`
    - `主动消息`
  - 页面展示 `本机 PostgreSQL`、`corepack pnpm run dev:local`、`DeepSeek 动态路由`、`OneBot`、`VoxCPM` 等关键运维字段。
  - 页面文本未出现 `app_session_id` 或 JWT 片段。
  - 页面级 `documentElement.scrollWidth === documentElement.clientWidth === 1280`。
- 移动视口 `390x844`：
  - 关键区域仍可见：`运行与数据库`、`LLM 路由`、`平台接入`、`主动消息`。
  - 页面级 `documentElement.scrollWidth === documentElement.clientWidth === 390`。
  - `body.scrollWidth === body.clientWidth === 390`。
  - 未发现宽度超过视口的 `section`、`aside`、`main` 或 `div` 候选元素。

### Settings 运维诊断页 polish 复验

- 使用本机运行数据库创建临时账号 `codex_phase5_polish_1780877086308`，验证后清理。
- 桌面视口 `1280x720`：
  - 可见 `QQ 实时状态` 为 `连接异常`。
  - 可见 `QQ 原始错误` 为 `fetch failed`，并同时显示行动建议 `NapCat / OneBot 不可访问`。
  - 可见 `微信实时状态` 为 `运行异常`。
  - 可见 `微信原始错误` 与行动建议 `微信 Web 登录已熔断`。
  - Runtime 能力显示 `文本`、`媒体`、`语音输入`、`语音输出`、`表情包`、`主动消息`、`自动绑定单角色`。
  - 页面文本未出现裸 `unknown`。
  - 页面级 `documentElement.scrollWidth === documentElement.clientWidth === 1280`，`body.scrollWidth === body.clientWidth === 1280`。
- 移动视口 `390x844`：
  - `运维诊断`、`平台接入`、QQ 行动建议和微信行动建议仍可见。
  - 页面级 `documentElement.scrollWidth === documentElement.clientWidth === 390`，`body.scrollWidth === body.clientWidth === 390`。
  - 顶部页签容器自身允许横向滚动，页面级没有横向溢出。

### 聊天页运行诊断入口验证

- 使用本机运行数据库创建临时账号 `codex_phase5_chat_1780875956084` 和临时角色 `Phase5 运行诊断角色`，验证后已通过 `deleteUserAccount` 清理，临时 Playwright session 与 `.playwright-cli` 残留已删除。
- 桌面视口 `1280x720` 打开 `/chat/5`：
  - 顶部诊断按钮存在，`title="运行诊断"`，`aria-label="打开运行诊断"`。
  - 页面文本未出现 `内心` 或 `心声`。
  - 打开面板后可见：
    - `角色运行诊断`
    - `最近运行事件`
    - `规划与反思诊断`
    - `隐藏反思`
  - 页面级 `documentElement.scrollWidth === documentElement.clientWidth === 1280`。
- 移动视口 `390x844` 打开同一聊天页：
  - 直接诊断按钮仍可见，标题为 `运行诊断`。
  - 更多菜单可见 `运行诊断` 菜单项。
  - 页面文本未出现 `内心` 或 `心声`。
  - 页面级 `documentElement.scrollWidth === documentElement.clientWidth === 390`。
  - `body.scrollWidth === body.clientWidth === 390`。

### 聊天页运行诊断 polish 复验

- 使用本机运行数据库创建临时角色 `/chat/6`，注入 `incoming_message`、`short`、`light`、`text` 等 runtime diagnostics 枚举值。
- 桌面视口 `1280x720`：
  - 可见 `角色运行诊断`、`最近运行事件`、`收到消息触发`、`短回复`、`轻量召回`、`输出 文字`、`隐藏反思`。
  - 页面文本未出现裸 `incoming_message`、`short`、`light`、`text`。
  - 页面级 `documentElement.scrollWidth === documentElement.clientWidth === 1280`，`body.scrollWidth === body.clientWidth === 1280`。
- 移动视口 `390x844`：
  - 可见 `角色运行诊断`、`收到消息触发`、`短回复`、`轻量召回`。
  - 页面文本未出现裸 `incoming_message` 或 `short`。
  - 页面级 `documentElement.scrollWidth === documentElement.clientWidth === 390`，`body.scrollWidth === body.clientWidth === 390`，未发现超出视口的候选元素。
- 浏览器 console 中有一次 Google Fonts `net::ERR_TIMED_OUT`，属于外部字体加载超时；页面 DOM、交互和布局指标已完成验证。

## 同步盘卫生

同步盘源码目录检查通过：

```powershell
node_modules、.env、dist、.vite、uploads 均不存在
```

## 下一步建议

1. 若后续接入新的平台状态或输出模式，优先补 `system.operationsDiagnostics` 和前端枚举映射，避免调试页重新出现裸英文枚举。
2. 可继续把“原始错误”旁边的行动建议扩成更细的排障清单，例如端口占用、NapCat HTTP API 未启用、Webhook 未上报。
3. 进入下一轮前可先把五阶段完成情况同步回 [docs/todo.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/docs/todo.md>)，避免路线图和日常 todo 脱节。
