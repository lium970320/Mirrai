# Mirrai 发布候选回归清单

> 用途：每次进入较大功能开发、提交前、或准备把 Mirrai 作为日常可用版本运行前，按这份清单做最小回归。  
> 约束：同步盘目录只保存源码；依赖、服务、数据库、浏览器验证都在 [F:/Code/Mirrai](<F:/Code/Mirrai>) 执行。

## 1. 同步盘卫生

在同步盘源码目录执行：

```powershell
git status --short --branch
git status --short --ignored
Get-ChildItem -Force -Name | Where-Object { $_ -in @('node_modules','dist','uploads','.vite','.env') }
```

期望：

- `git status` 可正常运行。
- 根目录没有 `.env`、`node_modules`、`dist`、`uploads`、`.vite`。
- `*.memory-card.json` 不再进入源码树。
- `drizzle/meta/` 当前可被忽略；如未来要纳入 journal，需要单独计划。

## 2. 同步到本机运行目录

在同步盘源码目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/sync-local-worktree.ps1
```

期望：

- 输出目标为 [F:/Code/Mirrai](<F:/Code/Mirrai>)。
- 不复制 `.env`，除非明确使用 `-CopyEnv`。
- 不把本机运行产物复制回同步盘。

## 3. 类型检查

在本机运行目录执行：

```powershell
cd F:\Code\Mirrai
corepack pnpm run check
```

期望：`tsc --noEmit` 通过。

## 4. 数据库迁移检查

只读检查当前 `DATABASE_URL` 指向的在线数据库是否具备 Plan2 关键表、列、索引和 enum：

```powershell
cd F:\Code\Mirrai
corepack pnpm run db:check
```

期望：

- 输出 `Status: OK (0 missing)`。
- 输出不包含数据库用户名、密码或完整连接串。
- 如果缺失 `persona_runtime_states`、`llm_usage_records`、roleplay 表、memory 字段或 `channel.qq`，先确认 `.env` 指向的是本机库还是 Neon，再执行迁移。

本机开发通常使用：

```powershell
cd F:\Code\Mirrai
corepack pnpm run db:local:prepare
corepack pnpm run db:local:check
```

`db:local:check` 会临时启动嵌入式本机 PostgreSQL、执行只读 schema 检查，然后关闭数据库；适合验证 `F:/.mirrai-local/Mirrai` 下的本机库。`db:check` 不会启动数据库，适合验证已经在线的 Neon / 远程库或正在运行的本机库。

正式 Neon / 远程 PostgreSQL 需要按部署流程执行：

```powershell
cd F:\Code\Mirrai
corepack pnpm run db:migrate
```

当前关键迁移：

- `0003_roleplay_channels.sql`
- `0004_structured_memory_cards.sql`
- `0005_qq_message_channel.sql`
- `0006_llm_usage_records.sql`
- `0007_llm_usage_attribution.sql`
- `0008_persona_runtime_states.sql`

注意：

- 本机 runtime helper 会兼容旧库自动补 `llm_usage_records` 和 `persona_runtime_states` 表 / 列，但正式库仍应执行迁移。
- 不要把本机 PostgreSQL 数据目录放入同步盘。

## 5. 核心 focused 测试

在本机运行目录执行：

```powershell
cd F:\Code\Mirrai
corepack pnpm exec vitest run server/llm/usage.test.ts server/llm/economy.test.ts server/llm/deepseek-routing.test.ts
corepack pnpm exec vitest run server/_core/persona-runtime.test.ts server/_core/persona-profile.test.ts server/_core/life-schedule.test.ts
corepack pnpm exec vitest run server/social/persona-text-chat.test.ts server/social/persona-text-runtime-platform.test.ts server/social/persona-media-runtime-platform.test.ts server/social/runtime-request.test.ts server/social/persona-turn-planner.test.ts
corepack pnpm exec vitest run server/social/memory-card.test.ts server/social/memory-consolidation.test.ts server/social/memory-governance.test.ts server/social/memory-recall.test.ts server/social/source-recall.test.ts server/social/source-grounding.test.ts
corepack pnpm exec vitest run server/qq/message-handler.test.ts server/qq/persona-bridge.test.ts server/wechat/persona-bridge.test.ts server/social/proactive-runtime.test.ts server/social/proactive-delivery.test.ts server/wechat/proactive-runtime-generation.test.ts server/wechat/proactive-scheduler.test.ts
corepack pnpm exec vitest run server/voice/voice-reply-policy.test.ts server/voice/audio-normalizer.test.ts server/voice/zhipu-asr.test.ts server/voice/voxcpm-voice-profile.test.ts server/stickers/sticker-policy.test.ts server/stickers/sticker-selector.test.ts
corepack pnpm exec vitest run server/social/roleplay-channel.test.ts server/social/output-diagnostics.test.ts
corepack pnpm exec vitest run server/data-export.test.ts
```

如果时间有限，最小烟测：

```powershell
cd F:\Code\Mirrai
corepack pnpm exec vitest run server/llm/usage.test.ts server/llm/economy.test.ts server/social/persona-text-runtime-platform.test.ts server/qq/message-handler.test.ts server/social/output-diagnostics.test.ts
```

最近一次基线结果：

- 2026-06-08：最小烟测通过，`5 passed / 29 tests passed`。
- 2026-06-08：`server/qq/message-handler.test.ts` 单文件通过，`1 passed / 16 tests passed`。
- 2026-06-08：`corepack pnpm run check` 通过。
- 记录见 [MIRRAI_PLAN2_PHASE_1_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PLAN2_PHASE_1_AUDIT.md>)。
- 2026-06-08：长期记忆 / 资料库 focused tests 通过，`6 passed / 19 tests passed`；最小烟测再次通过，`5 passed / 30 tests passed`；`corepack pnpm run check` 通过。记录见 [MIRRAI_PLAN2_PHASE_6_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PLAN2_PHASE_6_AUDIT.md>)。
- 2026-06-08：资料库只读产品化后再次验证：`corepack pnpm run check` 通过，source recall / grounding `2 passed / 9 tests passed`，memory focused `4 passed / 10 tests passed`；桌面 `1280x720` 和移动 `390x844` 浏览器 smoke 均无页面级横向溢出。
- 2026-06-08：Roleplay Beta focused tests 通过，`server/social/roleplay-channel.test.ts server/social/source-recall.test.ts server/llm/usage.test.ts server/llm/economy.test.ts` 为 `4 passed / 22 tests passed`；`corepack pnpm run check` 通过。记录见 [MIRRAI_PLAN2_PHASE_7_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PLAN2_PHASE_7_AUDIT.md>)。
- 2026-06-08：数据导出安全测试通过，`server/data-export.test.ts` 为 `1 passed / 3 tests passed`；确认导出包含 Plan2 新增私密区块且不包含密码哈希和 LLM API Key。记录见 [MIRRAI_PLAN2_PHASE_9_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PLAN2_PHASE_9_AUDIT.md>)。
- 2026-06-08：设置页真实导出 smoke 通过；下载 `mirrai-export-2026-06-08.json`，包含 persona / message / memory / source / roleplay / llmUsageRecords，且不包含 `passwordHash`、`apiKey` 或注册密码明文。
- 2026-06-08：persona runtime 表化 focused tests 通过，`server/_core/persona-runtime.test.ts server/data-export.test.ts server/_core/life-schedule.test.ts server/social/persona-text-runtime-platform.test.ts server/social/persona-media-runtime-platform.test.ts server/wechat/proactive-runtime-generation.test.ts` 为 `6 passed / 30 tests passed`；`corepack pnpm run check` 通过。记录见 [MIRRAI_PLAN2_PHASE_2_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PLAN2_PHASE_2_AUDIT.md>)。
- 2026-06-08：设置页持久化与数据安全诊断 focused tests 通过，`server/social/output-diagnostics.test.ts server/data-export.test.ts server/_core/persona-runtime.test.ts` 为 `3 passed / 17 tests passed`；接口 smoke 确认 `system.operationsDiagnostics.persistence` 返回 `persona_runtime_states`、`personaRuntimeStates` 导出/删除覆盖和 `0008_persona_runtime_states.sql`。记录见 [MIRRAI_PLAN2_PHASE_8_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PLAN2_PHASE_8_AUDIT.md>)。
- 2026-06-09：本机数据库迁移确认通过；`corepack pnpm run db:local:prepare` 自动补齐旧本机库缺失的 `channel.qq`，复查 `missingCount: 0`；`corepack pnpm run db:local:check` 输出 `Status: OK (0 missing)`。记录见 [MIRRAI_PLAN2_PHASE_4_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PLAN2_PHASE_4_AUDIT.md>)。
- 2026-06-09：省额度上限说明 focused tests 通过，`server/llm/economy.test.ts server/social/output-diagnostics.test.ts` 为 `2 passed / 13 tests passed`；`corepack pnpm run check` 通过。记录见 [MIRRAI_PLAN2_PHASE_3_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PLAN2_PHASE_3_AUDIT.md>)。
- 2026-06-09：设置页“运维诊断 / LLM 路由”Chrome headless 视觉 smoke 通过；桌面 `1280 x 720` 和移动 `390 x 844` 均可见上下文上限、记忆召回上限、资料库召回上限和每轮保护上限说明，页面级无横向溢出；临时账号已删除。
- 2026-06-09：删除 persona 后的孤立 Roleplay 频道策略已补齐；成员少于 2 个的频道会自动停用并保留历史壳，`server/social/roleplay-channel.test.ts server/data-export.test.ts server/_core/persona-runtime.test.ts` 为 `3 passed / 17 tests passed`，`corepack pnpm run check` 和 `corepack pnpm run db:check` 通过。
- 2026-06-09：QQ / OneBot 只读复核通过，Mirrai Web `200`、NapCat / QQ 进程在线、OneBot `OK`、`readyForManualE2E=true`，webhook smoke 返回 `ignored_self_message`；证据 baseline 已创建在 [qq-e2e-baseline-2026-06-09.json](<F:/.mirrai-local/Mirrai/logs/qq-e2e-baseline-2026-06-09.json>)，真实 inbound / outbound 仍等待测试联系人私聊。
- 2026-06-09：Plan2 阶段 10 收尾决策完成；本地稳定化主线可关闭，外部输入和后续计划边界记录见 [MIRRAI_PLAN2_PHASE_10_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PLAN2_PHASE_10_AUDIT.md>)。

## 6. 本机服务与 UI 烟测

启动：

```powershell
cd F:\Code\Mirrai
corepack pnpm run dev:local
```

浏览器检查：

- [http://localhost:3000](http://localhost:3000)
- `/settings` 的“运维诊断”页签：
  - 运行与数据库
  - LLM 路由
  - “LLM 路由”可见上下文上限、记忆召回上限、资料库召回上限和每轮保护上限说明。
  - 平台接入
  - Runtime 收敛
  - 持久化与数据安全
  - 语音
  - 表情包
  - 主动消息
  - “持久化与数据安全”可见 `persona_runtime_states`、`llm_usage_records`、`0008_persona_runtime_states.sql`、导出覆盖和删除覆盖。
- `/chat/:id`：
  - 顶部入口为“运行诊断”。
  - 面板标题为“角色运行诊断”。
  - 可见最近运行事件、Runtime 路由、投递与触发、隐藏反思、LLM 用量。
  - “记忆时间线”打开后标题为“记忆管理”，可见状态 / 类型 / 来源筛选、搜索、编辑、归档、标错、恢复。
  - “资料库”打开后可见 source 数、chunk 数、章节数、token 估算、关键词、source 列表、章节列表。
  - 资料库检索命中时可见原文片段、命中词和关联片段；无命中时可见证据不足提示。
- `/roleplay`：
  - 页面标题为“角色频道”。
  - 可见“允许沉默”开关。
  - 两个及以上 ready persona 可创建频道。
  - 成员选择区可见上移 / 下移排序按钮。
  - 频道创建后可见“频道还没有消息。”、“推进一轮”和“让 {角色名} 说话”。
  - 本机 smoke 默认不触发真实 LLM，只验证 Beta 入口、布局和可操作控件。

视口要求：

- 桌面：`1280x720`。
- 移动：`390x844`。
- 页面级 `document.documentElement.scrollWidth === document.documentElement.clientWidth`。
- 页面级 `document.body.scrollWidth === document.body.clientWidth`。
- 允许局部表格或顶部 tab 横向滚动，但不能撑开整页。

## 7. QQ / OneBot 手动验证

详细步骤见 [qq-e2e-verification.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/docs/qq-e2e-verification.md>)；本节只保留发布候选时必须确认的核心项。

前置：

- 本机服务已启动。
- NapCat / OneBot 已登录。
- `.env` 位于 [F:/Code/Mirrai/.env](<F:/Code/Mirrai/.env>)，且配置：
  - `QQ_ENABLED=true`
  - `QQ_ONEBOT_BASE_URL`
  - `QQ_ONEBOT_ACCESS_TOKEN` 如启用
  - `QQ_ONEBOT_WEBHOOK_SECRET` 如启用
  - `QQ_ALLOW_GROUPS=false` 除非明确测试群聊

手动验证项：

- 私聊文本进入共享 runtime 并回复。
- 群聊在默认关闭时被跳过。
- 用户发语音：下载 / 归一化 / ASR 任一步失败时自然提示或退回文字。
- 用户明确要求语音：TTS 成功时发 record，失败时退回文字。
- 用户发图片或表情包：进入 media runtime；无媒体但有文本时回退文本。
- 表情包策略失败、文件缺失或 OneBot 发送失败时不影响主文字回复。
- 主动消息投递到 QQ 时，消息记录 `channel` 为 `qq`。

日志关键词：

- `voice_in_download_failed`
- `voice_in_normalize_failed_fallback_text`
- `voice_asr_failed_fallback_text`
- `voice_tts_failed`
- `voice_send_failed_fallback_text`
- `sticker_send_failed_fallback_text`

## 8. 临时数据清理

浏览器或 smoke test 创建临时账号后，优先通过页面删除账户流程清理。

本机验证结束后确认：

- 临时用户、角色、消息已删除。
- Roleplay smoke 创建的临时频道、成员和消息应随临时用户通过 `deleteUserAccount` 清理。
- 数据导出 smoke 需要确认导出的 JSON 不包含 `passwordHash`、`apiKey`、session cookie 或本机数据库 / 缓存文件内容。
- 本机运行产物清理先 dry run：
  `powershell -ExecutionPolicy Bypass -File scripts/cleanup-local-runtime.ps1 -IncludeTtsCache -IncludeTmp -IncludePlaywright`
- 清理截图或 NapCat 下载缓存也先 dry run：
  `powershell -ExecutionPolicy Bypass -File scripts/cleanup-local-runtime.ps1 -IncludeScreenshots -IncludeNapCatDownloads`
- NapCat 登录态、VoxCPM runtime、torch runtime、Hugging Face / ModelScope 模型缓存属于大型 / 登录态运行时，只有明确要重登或重下载时才删除；dry run：
  `powershell -ExecutionPolicy Bypass -File scripts/cleanup-local-runtime.ps1 -IncludeNapCatRuntime -IncludeVoxcpmRuntime -IncludeTorchRuntime -IncludeModelCaches`
- 真正删除上述大型 / 登录态目标时必须同时传入 `-Apply` 和 `-ConfirmLargeRuntimeCleanup 'DELETE LARGE MIRRAI RUNTIME'`。
- `.playwright-cli` 临时目录已删除。
- 同步盘源码目录仍无 `.env`、`node_modules`、`dist`、`.vite`、`uploads`。
- 如启动过服务，明确是否继续保留；不需要时用对应 stop 脚本停止。

常用脚本：

```powershell
cd F:\Code\Mirrai
powershell -ExecutionPolicy Bypass -File scripts/status-mirrai.ps1
powershell -ExecutionPolicy Bypass -File scripts/stop-mirrai.ps1
```

## 9. 提交前说明

每次提交前至少写清：

- 改动属于哪个计划阶段。
- 是否涉及迁移。
- 是否涉及真实外部平台。
- 跑过哪些 focused 测试。
- 是否做过桌面 / 移动浏览器验证。
- 是否清理了临时账号和运行产物。
