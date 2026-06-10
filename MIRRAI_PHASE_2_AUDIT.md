# Mirrai 阶段 2 P0 可观测能力记录

记录时间：2026-06-08  
对应计划：[MIRRAI_WORK_PLAN.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_WORK_PLAN.md>)

## 本轮完成

### LLM 用量统计测试

- 为 LLM 用量统计增加 focused 测试：[usage.test.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/llm/usage.test.ts>)
- 在 [usage.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/llm/usage.ts>) 增加 `resetLlmUsageForTests()`，用于隔离内存用量记录测试状态。
- 测试覆盖：
  - 文本输入 token / 字符估算。
  - 图片输入按固定成本计入估算。
  - 空输出 token 为 0。
  - 今日调用量、成功 / 失败数量、输入 / 输出 / 总 token 汇总。
  - provider 和 purpose 分桶统计。
  - 最近调用按最新优先展示，并保留失败原因。

### 运行态拆分兼容层

- 新增运行态 facade：[persona-runtime.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/_core/persona-runtime.ts>)
- 新增 focused 测试：[persona-runtime.test.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/_core/persona-runtime.test.ts>)
- 暂定 canonical 运行态容器为 `personaData.personaRuntime`：
  - `personaRuntime.runtimeLifeState`
  - `personaRuntime.runtimeDiagnostics`
  - `personaRuntime.proactiveMessages.randomizedSchedule`
  - `personaRuntime.proactiveMessages.lastSent`
  - `personaRuntime.proactiveMessages.ambientPresence`
- 旧字段仍兼容读取：
  - `personaData.runtimeLifeState`
  - `personaData.runtimeDiagnostics`
  - `personaData.proactiveMessages.randomizedSchedule`
  - `personaData.proactiveMessages.lastSent`
  - `personaData.proactiveMessages.ambientPresence`
  - `personaData.profileSections.runtime.*`
- 用户可编辑配置仍保留在 `personaData.proactiveMessages`：
  - `enabled`
  - `times`
  - `stylePrompt`
- 已接入关键读写点：
  - [life-schedule.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/_core/life-schedule.ts>) 读写临时半睡半醒状态。
  - [persona-text-chat.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/persona-text-chat.ts>) 写入本轮 `runtimeDiagnostics`。
  - [proactive-scheduler.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/wechat/proactive-scheduler.ts>) 读写随机主动消息计划和 `lastSent`。
  - [ambient-proactive.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/wechat/ambient-proactive.ts>) 读写 ambient 主动消息运行态。
  - [routers.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/routers.ts>) 的 `persona.getRuntimeState` 返回 `personaRuntime` 和兼容后的 `runtimeDiagnostics`。
  - [PersonaEdit.tsx](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/client/src/pages/PersonaEdit.tsx>) 保存人物资料时不再把运行态字段写回 profile runtime。

### 诊断面板运行态展示

- 在 [PersonaStatePanel.tsx](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/client/src/components/PersonaStatePanel.tsx>) 的生活行程区补充运行态诊断：
  - 当前运行态容器来源：`personaRuntime` 或 legacy-compatible。
  - 临时生活状态和回合诊断是否存在。
  - 主动消息随机计划，包括原始时间、实际触发时间、偏移分钟和发送状态。
  - `lastSent` 已发送槽位。
  - ambient 主动消息状态，包括日期、最近发送、周期计数和今日目标。
- 随机计划表在移动视口使用局部横向滚动，不撑开整个页面。

### 平台输出策略诊断

- 新增输出策略诊断模块：[output-diagnostics.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/output-diagnostics.ts>)
- 新增 focused 测试：[output-diagnostics.test.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/output-diagnostics.test.ts>)
- 在 [voice-reply-policy.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/voice/voice-reply-policy.ts>) 和 [sticker-policy.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/stickers/sticker-policy.ts>) 导出当前策略配置读取函数，供诊断接口复用。
- [routers.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/routers.ts>) 的 `persona.getRuntimeState` 现在返回 `outputStrategy`，包含：
  - QQ / OneBot 接入摘要：是否启用、baseUrl、群聊、自动绑定、token / webhook secret 是否配置；不返回密钥原文。
  - 语音策略摘要：回复模式、概率、冷却、文本长度上限、ASR provider / model、TTS provider / fallback / VoxCPM 配置状态。
  - 表情包策略摘要：是否启用、概率、冷却、可用表情包数量、类型分布、避免重复数量。
  - 主动消息配置摘要：是否启用、固定时间槽、风格提示是否配置和短预览。
  - 网页 / QQ / 微信 runtime 输出能力汇总。
- [persona-text-chat.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/persona-text-chat.ts>) 的 `runtimeDiagnostics` 现在记录本轮 `voiceRequestDecision`，便于排查 planner 输出倾向和语音策略判定是否一致。
- [PersonaStatePanel.tsx](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/client/src/components/PersonaStatePanel.tsx>) 增加：
  - Planner 区块内的“语音请求判定”。
  - “平台输出策略 (Output Strategy)”折叠区块，展示 QQ 接入、语音、表情包、主动消息和 runtime 输出能力。

## 验证结果

已先同步源码到本机运行目录：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/sync-local-worktree.ps1
```

在本机运行目录 `F:/Code/Mirrai` 通过 focused 测试：

```powershell
corepack pnpm exec vitest run server/llm/usage.test.ts server/llm/deepseek-routing.test.ts server/social/persona-turn-planner.test.ts server/social/memory-recall.test.ts server/social/source-recall.test.ts
```

结果：5 个测试文件、17 个测试全部通过。

运行态拆分后，在本机运行目录 `F:/Code/Mirrai` 通过扩展后的 focused 测试：

```powershell
corepack pnpm exec vitest run server/_core/persona-runtime.test.ts server/_core/life-schedule.test.ts server/wechat/proactive-scheduler.test.ts server/_core/persona-profile.test.ts server/llm/usage.test.ts server/llm/deepseek-routing.test.ts server/social/persona-turn-planner.test.ts server/social/memory-recall.test.ts server/social/source-recall.test.ts
```

结果：9 个测试文件、39 个测试全部通过。

诊断面板 UI 改动后，在本机运行目录 `F:/Code/Mirrai` 通过：

```powershell
corepack pnpm exec vitest run server/_core/persona-runtime.test.ts server/_core/life-schedule.test.ts server/wechat/proactive-scheduler.test.ts server/llm/usage.test.ts
```

结果：4 个测试文件、17 个测试全部通过。

输出策略诊断补强后，在本机运行目录 `F:/Code/Mirrai` 通过：

```powershell
corepack pnpm run check
```

结果：`tsc --noEmit` 通过。

同时通过 focused 测试：

```powershell
corepack pnpm exec vitest run server/social/output-diagnostics.test.ts server/_core/persona-runtime.test.ts server/social/persona-text-chat.test.ts server/voice/voice-reply-policy.test.ts server/stickers/sticker-policy.test.ts server/llm/usage.test.ts
```

结果：6 个测试文件、32 个测试全部通过。

在本机运行目录 `F:/Code/Mirrai` 通过类型检查：

```powershell
corepack pnpm run check
```

结果：`tsc --noEmit` 通过。

已启动本机服务并做浏览器验证：

```powershell
cd F:/Code/Mirrai
corepack pnpm run dev:local
```

验证页面：

- `http://localhost:3000/chat/2`
- 诊断入口：`内心诊断`
- 桌面视口：默认浏览器视口，诊断面板可打开，Planner / Reflection 首屏正常，生活行程折叠区展开后可看到 `运行态容器`、`主动消息随机计划`、`已发送槽位`、`Ambient 存在感`。
- 移动视口：390 x 844，诊断面板可打开；页面本身无横向滚动，随机计划表在局部容器内横向滚动。

输出策略诊断补强后，使用 Playwright CLI 在本机服务 `http://localhost:3000/chat/3` 做临时账号验证：

- 桌面视口：诊断面板可打开，Planner 区块显示“语音请求判定”，包含明确语音请求、置信度和判定原因。
- 桌面视口：展开“平台输出策略 (Output Strategy)”后，可见 QQ 接入、语音策略、表情包策略、主动消息配置和 Runtime 输出能力。
- 移动视口：390 x 844，`document.documentElement.scrollWidth === document.documentElement.clientWidth`，页面级无横向溢出。
- 验证用本机临时 `codex_diag_output_*` 用户和角色已从本机 PostgreSQL 删除。

## 注意事项

- 当前 LLM 用量统计仍是进程内内存记录，尚未做持久化；这符合阶段 2 的最低验收，但跨重启保留仍是可选后续增强。
- 当前运行态拆分是兼容层，不是数据库迁移；旧字段会继续读取，新的写入优先进入 `personaRuntime`。
- `proactiveMessages.enabled/times/stylePrompt` 被视为用户配置，不是临时运行态，暂不迁出。
- 输出策略诊断只返回配置摘要和密钥是否存在，不返回 token、webhook secret、API key 或 prompt 原文长内容。
- 本轮没有修改数据库 schema。
- 本轮曾误在同步盘源码目录执行一次 `corepack pnpm exec vitest ...`，导致 pnpm 恢复 `node_modules/`；该运行产物已在确认路径后删除。
- 浏览器验证期间曾在本机 PostgreSQL 创建临时 `codex_diag_*` 用户和诊断测试角色；验证结束后已删除临时用户、角色和消息，只保留原有本机数据。
- 本机服务 `corepack pnpm run dev:local` 当前仍在运行，用于本轮 UI 验证；如不继续调试，可停止该进程。

## 下一步建议

1. 阶段 2 剩余可选增强：如果后续需要跨重启追踪 LLM 用量，再设计持久化表和迁移；当前先保持进程内统计。
2. 阶段 3 可以开始围绕 QQ 主链路补 OneBot fixture 和失败降级测试，优先覆盖语音下载 / 转码 / ASR / TTS / 发送失败日志。
3. 后续如继续整理 UI，可把平台输出策略里的 QQ / 语音 / 表情包配置逐步迁到设置页，诊断面板只保留运行状态和最近判定。

## 2026-06-08 补充：LLM 用量持久化增强

### 本轮完成

- 新增持久化表定义：[schema.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/drizzle/schema.ts>)
  - 表名：`llm_usage_records`
  - 只保存统计元数据：provider、requestedProvider、model、purpose、startedAt、durationMs、token / 字符估算、成功失败和短错误信息。
  - 不保存 prompt、用户消息全文或 LLM 回复全文。
- 新增手写迁移：[0006_llm_usage_records.sql](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/drizzle/0006_llm_usage_records.sql>)
  - 创建 `llm_usage_records`。
  - 增加 startedAt、provider+startedAt、purpose+startedAt 索引。
- 更新 DB helper：[db.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/db.ts>)
  - 新增 `createLlmUsageRecord`。
  - 新增 `getPersistentLlmUsageSnapshot`，汇总今日、本周、本月、今日 provider / purpose 分桶和最近 20 条调用。
  - 增加 `ensureLlmUsageTable`，本机运行时可自动补表，避免旧本机库缺表导致诊断不可用。
- 更新 LLM 用量模块：[usage.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/llm/usage.ts>)
  - `recordLlmUsage` 继续同步写入进程内 ring buffer。
  - 新增可选 persistent recorder；写库失败只记录 warning，不阻塞 LLM 回复链路。
- 更新 LLM service：[index.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/llm/index.ts>)
  - 注册 DB persistent recorder。
  - 成功 / 失败 LLM 调用都会尝试写入 `llm_usage_records`。
- 更新运维诊断接口：[systemRouter.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/_core/systemRouter.ts>)
  - 优先读取数据库持久化用量。
  - 数据库不可用或读取失败时回退到当前进程内统计，并标记 `source: "in-memory-runtime"`。
- 更新设置页：[Settings.tsx](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/client/src/pages/Settings.tsx>)
  - LLM 路由区新增“用量来源”。
  - 展示今日、本周、本月 token 和调用次数。

### 验证结果

- 同步到本机运行目录后运行：

```powershell
corepack pnpm run check
corepack pnpm exec vitest run server/llm/usage.test.ts server/social/output-diagnostics.test.ts
```

- 结果：`tsc --noEmit` 通过；2 个测试文件、6 个测试全部通过。
- 本机 PostgreSQL smoke test：
  - 通过 `createLlmUsageRecord` 插入一条 `Codex-Test` 用量记录。
  - `getPersistentLlmUsageSnapshot(new Date("2026-06-08T12:00:00.000Z"))` 返回 `source: "database"`。
  - 今日 / 本周 / 本月调用数均能包含该测试记录，provider / recent 也能查到该记录。
  - 验证后已删除 `provider = "Codex-Test"` 的测试记录。

### 注意事项

- Neon / 正式数据库仍需要按部署流程执行迁移；本机运行时 helper 会自动补表，但不能替代正式迁移流程。
- 当前持久化是应用级统计，不做用户级隔离；后续如需要多用户成本归属，可再增加 `userId` / `personaId` / `route` 字段。

## 2026-06-08 补充：LLM 软额度诊断提醒

### 本轮完成

- 新增配置项：[.env.example](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/.env.example>)
  - `LLM_DAILY_SOFT_TOKEN_LIMIT`
  - `LLM_MONTHLY_SOFT_TOKEN_LIMIT`
  - `LLM_BUDGET_WARNING_RATIO`
- 更新环境读取：[env.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/_core/env.ts>)
  - 默认每日 / 月度软额度为 0，表示不启用提醒。
  - 默认 warning ratio 为 0.8。
- 更新运维诊断：[output-diagnostics.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/output-diagnostics.ts>)
  - 新增 `getLlmBudgetDiagnostics`。
  - 根据当前 usage 的今日 / 月度 token 计算 `disabled`、`ok`、`warn`、`exceeded` 状态。
  - 只输出诊断建议，不自动改变 LLM 路由或回复策略。
- 更新系统接口：[systemRouter.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/_core/systemRouter.ts>)
  - `system.operationsDiagnostics` 返回 `llm.budget`。
- 更新设置页：[Settings.tsx](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/client/src/pages/Settings.tsx>)
  - LLM 路由区新增软额度状态、每日软额度、月度软额度和额度建议。

### 验证结果

```powershell
corepack pnpm run check
corepack pnpm exec vitest run server/social/output-diagnostics.test.ts server/llm/usage.test.ts
```

- 已从 [本机运行目录](<F:/Code/Mirrai>) 执行 `corepack pnpm run check`，结果通过。
- 已从 [本机运行目录](<F:/Code/Mirrai>) 执行 focused vitest，`server/social/output-diagnostics.test.ts` 与 `server/llm/usage.test.ts` 共 7 个测试通过。
- 已在本机服务 [http://localhost:3000/settings](http://localhost:3000/settings) 验证“运维诊断”页：
  - LLM 路由区显示 `软额度状态`、`每日软额度`、`月度软额度`、`额度建议`。
  - 当前本机未配置软额度时，状态按预期显示为 `未配置`。
  - 桌面视口与 `390x844` 移动视口均无横向溢出。
- 临时验证账号 `codex_budget_20260608085851` 已通过页面删除账户流程清理，重新登录返回 401。
- Playwright 临时会话已关闭，[本机运行目录](<F:/Code/Mirrai>) 下 `.playwright-cli` 临时产物已删除。

### 注意事项

- 本轮只做提醒，不做自动省额度执行。
- 后续如果接入自动省额度，应优先从低价值链路开始：语音智能判断、TTS 前置润色、非必要主动消息、过长历史上下文和低价值原著召回。

## 2026-06-08 补充：LLM 省额度模式自动执行第一版

### 本轮完成

- 新增策略层：[economy.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/llm/economy.ts>)
  - 统一计算 `off`、`conservative`、`strict` 三档 economy policy。
  - 复用软额度诊断结果，避免诊断页与业务执行使用两套阈值。
  - 读取持久化 LLM usage，失败时回退进程内 usage，并加短缓存避免高频查库。
- 更新运维诊断：
  - [systemRouter.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/_core/systemRouter.ts>) 返回 `llm.economy`。
  - [Settings.tsx](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/client/src/pages/Settings.tsx>) 展示省额度模式、自动降成本动作和执行建议。
- 接入低价值 / 可降级链路：
  - [voice-reply-policy.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/voice/voice-reply-policy.ts>)：`strict` 下跳过非显式语音回复和语音智能判断；用户明确要求语音时仍放行。
  - [tts.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/_core/tts.ts>)：`conservative` / `strict` 下跳过 VoxCPM 的 LLM 语音稿润色，保留本地 humanize 和 TTS 生成。
  - [ambient-proactive.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/wechat/ambient-proactive.ts>)：`conservative` / `strict` 下跳过非强制环境主动消息；`force` 手动验证仍可执行。
  - [proactive-scheduler.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/wechat/proactive-scheduler.ts>)：`strict` 下跳过定时主动消息。
  - [source-grounding.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/source-grounding.ts>)：省额度时降低原著证据改写 token 上限，不跳过事实核查。
- 更新文档：
  - [MIRRAI_WORK_PLAN.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_WORK_PLAN.md>)
  - [docs/todo.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/docs/todo.md>)

### 验证结果

```powershell
corepack pnpm run check
corepack pnpm exec vitest run server/llm/economy.test.ts server/social/output-diagnostics.test.ts server/voice/voice-reply-policy.test.ts server/wechat/proactive-runtime-generation.test.ts server/social/source-grounding.test.ts
```

- 已从 [本机运行目录](<F:/Code/Mirrai>) 执行 `corepack pnpm run check`，结果通过。
- 已从 [本机运行目录](<F:/Code/Mirrai>) 执行 focused vitest，5 个测试文件、34 个测试通过。
- 已在本机服务 [http://localhost:3000/settings](http://localhost:3000/settings) 验证“运维诊断”页：
  - LLM 路由区显示 `省额度模式`、`自动降成本`、`执行建议`。
  - 当前本机未配置软额度时，省额度模式按预期显示为 `未启用`，自动降成本显示 `未执行自动降成本`。
  - 桌面视口与 `390x844` 移动视口均无横向溢出。
- 临时验证账号 `codex_economy_20260608093527` 已通过页面删除账户流程清理，重新登录返回 401。
- Playwright 临时会话已关闭，[本机运行目录](<F:/Code/Mirrai>) 下 `.playwright-cli` 临时产物已删除。

### 注意事项

- 当前是自动省额度第一版，重点覆盖低价值或可替代链路；不会阻断用户明确要求的语音，也不会跳过原著证据核查。
- 后续可继续把过长历史上下文、资料库召回数量和低价值原著召回触发纳入 economy policy。

## 2026-06-08 补充：LLM 用户 / 角色 / route 成本归属

### 本轮完成

- 扩展 LLM 调用参数：[types.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/llm/types.ts>)
  - `LLMOptions` 新增 `userId`、`personaId`、`route`，用于把一次调用归属到用户、角色和业务入口。
- 扩展用量记录：[usage.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/llm/usage.ts>)
  - 内存用量 snapshot 新增 `byUser`、`byPersona`、`byRoute` 今日分桶。
  - 最近调用记录保留归属字段，方便追查单次调用来源。
- 扩展持久化：[schema.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/drizzle/schema.ts>)、[db.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/db.ts>)
  - `llm_usage_records` 新增 nullable `userId`、`personaId`、`route`。
  - `getPersistentLlmUsageSnapshot` 返回用户、角色和入口分桶，并在 recent 记录中带回归属字段。
  - `ensureLlmUsageTable` 会为本机旧库自动补列和索引，保证诊断页不因缺列失效。
- 新增迁移：[0007_llm_usage_attribution.sql](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/drizzle/0007_llm_usage_attribution.sql>)
  - 增加 `userId`、`personaId`、`route` 三列。
  - 增加 `llm_usage_user_started_idx`、`llm_usage_persona_started_idx`、`llm_usage_route_started_idx`。
- 更新运维诊断 UI：[Settings.tsx](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/client/src/pages/Settings.tsx>)
  - LLM 路由区新增 `今日用户归属`、`今日角色归属`、`今日入口归属`。
- 主要 LLM 调用点已传入归属信息：
  - 社交文字 / 媒体 / 原著证据 / 反思。
  - 记忆提取、每日总结、角色群聊。
  - 定时 / 环境主动消息。
  - 语音智能判断与 TTS 润色。
  - 人物分析、图片分析、毕业信、日记、技能管线。

### 验证结果

同步源码到本机运行目录后，在 [F:/Code/Mirrai](<F:/Code/Mirrai>) 通过：

```powershell
corepack pnpm run check
corepack pnpm exec vitest run server/llm/usage.test.ts server/social/output-diagnostics.test.ts server/social/persona-text-chat.test.ts server/social/persona-media-runtime-platform.test.ts server/wechat/proactive-runtime-generation.test.ts server/social/source-grounding.test.ts server/social/memory-consolidation.test.ts server/social/roleplay-channel.test.ts
```

- `tsc --noEmit` 通过。
- 8 个测试文件、34 个测试全部通过。

本机 PostgreSQL smoke test：

- 通过 `createLlmUsageRecord` 插入 `provider = "Codex-Attribution-Test"` 的临时记录。
- 临时记录包含 `userId = 4242`、`personaId = 2424`、`route = "codex.attribution.smoke"`、`totalTokens = 18`。
- `getPersistentLlmUsageSnapshot(new Date("2026-06-08T13:00:00.000Z"))` 能在 `byUser`、`byPersona`、`byRoute` 和 `recent` 中返回该归属。
- 验证后已删除该测试记录。

浏览器验证：

- 已在本机服务 [http://localhost:3000/settings](http://localhost:3000/settings) 的“运维诊断”页验证 LLM 路由区。
- 页面显示 `今日用户归属`、`今日角色归属`、`今日入口归属`；当前无用量时显示 `暂无`。
- 桌面视口与 `390x844` 移动视口均无页面级横向溢出。
- 临时验证账号 `codex_attrib_20260608105032` 已通过页面删除账户流程清理，重新登录返回 401。

### 注意事项

- 正式 Neon 数据库仍需要按部署流程执行 [0007_llm_usage_attribution.sql](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/drizzle/0007_llm_usage_attribution.sql>)；本机自动补列只用于兼容旧本机库。
- 部分全局或工具型 LLM 调用只记录 `route`，没有清晰用户 / 角色上下文时会归入未分配。
- 当前诊断页先展示 top 4 分桶字符串；如果后续要做多用户账单或审计报表，可以再扩展成明细表和筛选器。

## 2026-06-08 补充：原始错误排障清单

### 本轮完成

- 新增后端排障分类：[output-diagnostics.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/output-diagnostics.ts>)
  - 新增 `getOperationsTroubleshootingDiagnostics`。
  - 支持把数据库连接串异常、LLM 用量持久化读库失败、QQ / OneBot 错误、微信 Web 登录 / 同步熔断分类成可行动建议。
  - 统一返回 `summary`、`items` 和 `platforms.qq/wechat`，每条包含 scope、title、detail、tone、rawError、evidence 和 actions。
  - 原始错误会做基础脱敏：隐藏 URL 账号密码、Bearer、api key、access token、token、password、secret 等参数。
- 更新系统诊断接口：[systemRouter.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/_core/systemRouter.ts>)
  - `system.operationsDiagnostics` 返回 `troubleshooting`。
  - LLM 持久化用量读取失败时，仍回退进程内统计，并把失败原因交给排障清单展示。
- 更新设置页：[Settings.tsx](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/client/src/pages/Settings.tsx>)
  - 运维诊断页新增“原始错误排障清单”区块。
  - 每条建议显示分类、摘要、脱敏后的 raw error 和 1/2/3 步处理建议。
  - 平台接入卡片复用后端 `platforms.qq/wechat` 分类结果，前端旧逻辑保留为兼容 fallback。

### 验证结果

同步源码到本机运行目录后，在 [F:/Code/Mirrai](<F:/Code/Mirrai>) 通过：

```powershell
corepack pnpm run check
corepack pnpm exec vitest run server/social/output-diagnostics.test.ts
```

- `tsc --noEmit` 通过。
- 1 个测试文件、6 个测试全部通过。
- focused 测试覆盖：
  - 数据库 invalid URL 分类。
  - LLM 用量持久化读库失败提醒。
  - QQ `fetch failed / ECONNREFUSED` 分类为 NapCat / OneBot 不可访问。
  - 微信 sync circuit breaker 分类。
  - raw error 脱敏不暴露 URL 密码、token、password。
  - 健康平台状态不进入待处理清单。

浏览器验证：

- 已在本机服务 [http://localhost:3000/settings](http://localhost:3000/settings) 的“运维诊断”页验证新增区块。
- 当前本机状态下，“原始错误排障清单”显示：
  - QQ：`NapCat / OneBot HTTP API 不可访问`，包含 3 步检查建议。
  - 微信：`微信 Web 登录 / 同步已熔断`，包含 3 步处理建议。
- 桌面视口显示正常。
- 移动视口 `390x844` 下 `document.documentElement.scrollWidth === document.documentElement.clientWidth`，页面级无横向溢出。
- 临时验证账号 `codex_troubleshoot_20260608151107` 已通过页面删除账户流程清理，重新登录返回 401。

### 注意事项

- 当前分类覆盖最常见的运维错误，不替代完整日志；未知错误会保留脱敏 raw error，并提示继续查看本机服务日志。
- “健康”和“未启用”状态不会进入待处理清单，但仍会在平台接入卡片中显示状态说明。
- 后续可继续把更多外部链路错误接入同一 `troubleshooting` 结构，例如真实 NapCat E2E 的 messageId / contactId 级别证据。

## 2026-06-08 补充：语音 / 表情包排障分类

### 本轮完成

- 新增进程内最近运维事件缓存：[operations-events.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/_core/operations-events.ts>)
  - 保留最近 50 条运行事件，当前用于排障展示，不写数据库。
  - 事件包含 scope、title、detail、rawError、evidence 和时间；输出到诊断前会脱敏。
- 接入语音链路错误事件：
  - [audio-normalizer.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/voice/audio-normalizer.ts>) 记录 ffmpeg 转码失败、SILK 解码失败和不支持的音频格式。
  - [zhipu-asr.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/voice/zhipu-asr.ts>) 记录 ASR 未配置、HTTP 请求失败和空转写结果。
  - [tts.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/_core/tts.ts>) 记录 VoxCPM / MiniMax / Edge TTS fallback 失败。
  - [message-handler.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/qq/message-handler.ts>) 记录 QQ record 语音发送失败和 QQ 语音生成失败 fallback。
- 接入表情包链路错误事件：
  - [sticker-sender.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/stickers/sticker-sender.ts>) 记录文件不存在、文件无效、不支持类型、OneBot image 发送失败和发送异常。
  - QQ handler 记录表情包策略允许但素材未匹配。
- 扩展运维排障分类：[output-diagnostics.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/output-diagnostics.ts>)
  - `TroubleshootingScope` 增加 `voice` 和 `stickers`。
  - ASR key、VoxCPM URL、VoxCPM 参考音频、MiniMax 凭据、表情包素材文件缺失会生成配置级建议。
  - 最近语音 / 表情包运行事件会转换成行动建议，并展示脱敏 raw error。
- 前端设置页文案从“原始错误排障清单”调整为“运维排障清单”，覆盖配置预警、运行事件和 raw error。

### 验证结果

同步源码到本机运行目录后，在 [F:/Code/Mirrai](<F:/Code/Mirrai>) 通过：

```powershell
corepack pnpm run check
corepack pnpm exec vitest run server/social/output-diagnostics.test.ts server/voice/audio-normalizer.test.ts server/voice/zhipu-asr.test.ts server/stickers/sticker-sender.test.ts server/qq/message-handler.test.ts
```

- `tsc --noEmit` 通过。
- 5 个测试文件、30 个测试全部通过。
- 新增 focused 覆盖：
  - 最近 ASR / sticker 运行失败会进入运维排障清单。
  - raw error 中的 token / access token 会脱敏。
  - sticker sender 文件缺失会记录 `stickers.file_not_found` 运维事件。

### 注意事项

- 最近运维事件是进程内缓存；重启后清空，适合“刚才为什么失败”的现场排查，不替代长期审计日志。
- 这轮不启动真实 QQ / NapCat / VoxCPM / ASR 服务，不做外部在线 E2E。
- 后续真实 NapCat E2E 时，可以继续把 messageId / contactId / provider 状态接到同一排障结构里。

## 2026-06-08 补充：上下文 / 召回分级降级第一版

### 本轮完成

- 扩展省额度策略：[economy.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/llm/economy.ts>)
  - 新增 `context` 上限：历史读取条数、进入 LLM 的历史条数、连续性时间线条数、reflection / recall / consolidation 最近上下文条数。
  - 新增 `memoryRecall` 上限：长期记忆条数与每条描述最大字符数。
  - 新增 `sourceRecall` 上限：原著证据条数、每条证据摘录最大字符数，并保留原有 rewrite token 上限。
  - `off / conservative / strict` 分别保持完整、适度缩短、严格缩短；不会直接关闭长期记忆或原著事实核查。
- 接入文字社交 runtime：[persona-text-chat.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/persona-text-chat.ts>)
  - `getMessagesByPersonaId` 按 `economy.context.historyFetchLimit` 读取历史。
  - LLM 历史按 `llmHistoryLimit` 裁剪。
  - turn plan、reflection、连续性提示、长期记忆召回、原著资料召回、记忆沉淀各自使用对应最近上下文上限。
  - runtime diagnostics 记录本轮 economy level、context、memoryRecall 和 sourceRecall 上限，方便解释为什么这轮上下文变短。
- 接入媒体社交 runtime：[persona-media-chat.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/persona-media-chat.ts>)
  - 图片 / 表情包回复同样按 economy policy 缩短历史、连续性提示和长期记忆召回。
  - runtime diagnostics 记录本轮 economy 上限。
- 更新召回格式化：
  - [memory-recall.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/memory-recall.ts>) 支持 `maxDescriptionChars`。
  - [source-recall.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/source-recall.ts>) 支持 `maxExcerptChars`。
  - [conversation-continuity.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/conversation-continuity.ts>) 支持 recent / timeline 上限。

### 验证结果

同步源码到本机运行目录后，在 [F:/Code/Mirrai](<F:/Code/Mirrai>) 通过：

```powershell
corepack pnpm run check
corepack pnpm exec vitest run server/llm/economy.test.ts server/social/conversation-continuity.test.ts server/social/memory-recall.test.ts server/social/source-recall.test.ts server/social/persona-text-runtime-platform.test.ts server/social/persona-media-runtime-platform.test.ts server/social/source-grounding.test.ts
```

- `tsc --noEmit` 通过。
- 7 个测试文件、21 个测试全部通过。
- focused 测试覆盖：
  - conservative / strict policy 的上下文、记忆召回、原著召回上限。
  - 连续性时间线按 economy 上限裁剪。
  - 长期记忆描述按 `maxDescriptionChars` 裁剪。
  - 原著证据摘录按 `maxExcerptChars` 裁剪。
  - strict 模式下文字 runtime 只向 LLM 传入收缩后的历史窗口，并把召回上限传给 memory / source recall。
  - 媒体 runtime 在新增 economy 调用后仍保持 Web / WeChat / QQ 共享链路可用。

### 注意事项

- 本轮只缩短上下文和召回体量，不禁用关键事实核查；原著问题仍会进入原著证据模式，避免省额度导致编剧情。
- strict 模式下上下文更短，可能减少远距离上下文的细腻度；runtime diagnostics 会记录当时的裁剪上限，方便回溯。
- 后续如需要更进一步，可把“低价值原著召回触发”和“资料库召回数量”做成更细的按 intent / route 分级，而不是全局固定值。

## 2026-06-08 补充：LLM 用量明细筛选 / 运维查账

### 本轮完成

- 扩展内存用量查询：[usage.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/llm/usage.ts>)
  - 新增 `getLlmUsageDetails`，支持按时间、用户、角色、route、provider、purpose、成功状态和 limit 过滤。
  - 明细汇总返回调用数、成功 / 失败数、输入 / 输出 / 总 tokens 和平均耗时。
  - `userId: null` / `personaId: null` 可用于查询未归属记录。
- 扩展数据库用量查询：[db.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/db.ts>)
  - 新增 `getPersistentLlmUsageDetails`，复用 `llm_usage_records` 做只读明细筛选。
  - 数据库不可用时由系统接口回退到进程内明细，不阻断诊断页。
- 新增系统接口：[systemRouter.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/_core/systemRouter.ts>)
  - 新增 `system.llmUsageDetails` protected query。
  - 普通用户强制 `userId = ctx.user.id`；管理员可全局查询或按用户 ID 查询。
  - 输入限制 route / provider / purpose 长度，limit 限制在 1 到 200。
- 更新运维诊断页：[Settings.tsx](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/client/src/pages/Settings.tsx>)
  - LLM 路由区新增“用量明细”。
  - 支持时间范围、用户 ID（管理员）、角色 ID、route、provider、purpose、成功状态和条数筛选。
  - 展示来源、汇总、最近调用 provider / model / purpose / route / user / persona / tokens / 耗时 / 短错误预览。
  - 不展示 prompt、用户消息全文或 LLM 回复全文。

### 验证结果

同步源码到本机运行目录后，在 [F:/Code/Mirrai](<F:/Code/Mirrai>) 通过：

```powershell
corepack pnpm run check
corepack pnpm exec vitest run server/llm/usage.test.ts server/social/output-diagnostics.test.ts
```

- `tsc --noEmit` 通过。
- 2 个测试文件、12 个测试全部通过。
- 新增 focused 覆盖：
  - 明细记录按用户、角色、route、provider、purpose、成功状态、时间范围组合过滤。
  - limit 会被夹到 1 到 200。
  - 未归属用户 / 角色记录可被 `null` 筛选命中。

浏览器验证：

- 已在本机服务 [http://localhost:3000/settings](http://localhost:3000/settings) 的“运维诊断”页验证 LLM 路由区。
- 桌面视口可见“用量明细”、筛选项、来源摘要和明细汇总。
- 移动视口 `390 x 844` 下可见“用量明细”和筛选项，`document.documentElement.scrollWidth === document.documentElement.clientWidth`，页面级无横向溢出。
- 临时验证账号 `codex_usage_1780914997893` 已通过页面删除账户流程清理，重新登录返回登录页。

### 注意事项

- 该接口是运维查账视图，只返回用量元数据和短错误预览，不返回对话内容。
- 数据库明细依赖 `llm_usage_records` 已具备 `userId`、`personaId`、`route` 字段；正式 Neon 仍需保证历史迁移已执行。
- 后续如要做更完整审计报表，可在当前接口基础上增加导出、分页游标或按日期聚合视图。

## 2026-06-08 补充：按 intent / route 细分召回降级

### 本轮完成

- 扩展 economy policy：[economy.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/llm/economy.ts>)
  - 新增 `buildLlmTurnEconomyPolicy`。
  - 在全局 `off / conservative / strict` 额度档位之上，按本轮 route / platform / intent / sourceRecallActive 二次收束召回体量。
  - 新增 profile：
    - `high_frequency_chat`：QQ / 微信日常短聊，降低历史、长期记忆和原著召回体量。
    - `source_guarded`：原著 / 纠错问题，保留原著证据，压低长期关系记忆，避免记忆污染。
    - `media_light`：图片 / 表情包回复，以当前媒体描述为主，只保留轻量上下文和关系记忆。
    - `technical_light`：技术 / 正式问题，减少人格记忆召回。
    - `proactive_minimal`：主动消息入口，使用最小上下文和召回。
    - `relationship_focus`：情绪支持 / 深情表达，保留关系记忆，限制原著召回。
- 接入文字社交 runtime：[persona-text-chat.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/persona-text-chat.ts>)
  - 原著召回前先用 source-guarded 预策略控制 evidence 数量和摘录长度。
  - turn planner 得出 intent 后，再按实际 intent / route 生成本轮 economy policy。
  - reflection、长期记忆召回、连续性提示、LLM 历史、记忆沉淀和原著 rewrite 使用本轮细分后的上限。
  - runtime diagnostics 增加 `economy.recallDegradation`，记录 profile、route、platform、intent、sourceRecallActive 和原因。
- 接入媒体社交 runtime：[persona-media-chat.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/persona-media-chat.ts>)
  - 图片 / 表情包回复走 `media_light` profile。
  - runtime diagnostics 同样记录 `economy.recallDegradation`。

### 验证结果

同步源码到本机运行目录后，在 [F:/Code/Mirrai](<F:/Code/Mirrai>) 通过：

```powershell
corepack pnpm run check
corepack pnpm exec vitest run server/llm/economy.test.ts server/social/persona-text-runtime-platform.test.ts server/social/persona-media-runtime-platform.test.ts server/social/source-recall.test.ts server/social/source-grounding.test.ts
```

- `tsc --noEmit` 通过。
- 5 个测试文件、20 个测试全部通过。
- 新增 focused 覆盖：
  - QQ 高频日常短聊会使用 `high_frequency_chat`，即使全局 economy 为 off，也会压低低价值高频入口召回体量。
  - 原著问题会使用 `source_guarded`，QQ source recall evidence 限制为 5 条、摘录 680 字，同时长期记忆压到 1 条 / 120 字。
  - 主动消息 route 会使用 `proactive_minimal`。
  - 媒体回复会使用 `media_light`，并在 diagnostics 里记录 profile。
  - strict economy 与 route profile 叠加时只会进一步收束，不会放宽全局严格上限。

### 注意事项

- 本轮是策略层和 runtime 接入，不修改数据库 schema，也不需要 UI 新控件。
- `source_guarded` 保留原著证据核查，不会因为省额度直接跳过事实校验；它主要压低长期关系记忆，避免混入不相关共同经历。
- 高频 QQ / 微信日常短聊即使未超额，也会按 route 做轻量召回，这是为了降低高频入口的默认成本；需要更完整背景时，source / 情绪 / 深情等高价值 intent 会走自己的 profile。
