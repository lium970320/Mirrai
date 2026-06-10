# Mirrai Plan2 阶段 2 运行态与 LLM 用量持久化收束记录

记录时间：2026-06-08  
对应计划：[MIRRAI_WORK_PLAN_2.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_WORK_PLAN_2.md>)

## 阶段目标

阶段 2 的目标是把 Mirrai 的运行态从“当前进程可看、兼容写在 personaData 里”收束成跨重启可追溯、可导出、可删除、且不继续污染稳定人物画像的持久化结构。

## 已有基线

- `llm_usage_records` 已在 Plan1 / Plan2 早期落地，支持 provider、model、purpose、token 估算、耗时、成败、`userId`、`personaId` 和 `route` 归属。
- `server/_core/persona-runtime.ts` 已提供 `personaRuntime` 兼容层，业务层仍可用统一方式读取临时生活状态、主动消息运行态和最近 diagnostics。
- 诊断面板、设置页运维诊断和 focused tests 已能读取这些 runtime diagnostics。

## 本轮完成内容

### Persona Runtime 独立表

修改位置：

- [drizzle/schema.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/drizzle/schema.ts>)
- [drizzle/0008_persona_runtime_states.sql](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/drizzle/0008_persona_runtime_states.sql>)
- [server/db.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/db.ts>)

变更：

- 新增 `persona_runtime_states`：
  - `personaId`
  - `userId`
  - `runtimeLifeState`
  - `runtimeDiagnostics`
  - `proactiveRuntime`
  - `createdAt`
  - `updatedAt`
- 为 `(personaId, userId)` 建唯一索引，为 `userId` 建查询索引。
- 新增 `ensurePersonaRuntimeStatesTable`，与现有 runtime helper 一样用于旧库兼容补表；正式库仍应执行迁移。

### 读写路径拆分

修改位置：

- [server/db.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/db.ts>)
- [server/_core/persona-runtime.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/_core/persona-runtime.ts>)

变更：

- persona 读取路径会把 runtime row 合并回业务可见的 `personaData.personaRuntime`：
  - `getPersonasByUserId`
  - `getReadyPersonasForProactiveMessages`
  - `getReadyPersonasForDailyMemory`
  - `getPersonasWithStats`
  - `getPersonaById`
  - `getExportData`
- `updatePersona` 在收到 `personaData` 时会先调用 `extractPersonaRuntimeForStorage`：
  - 稳定画像和用户配置仍写回 `personas.personaData`。
  - `runtimeLifeState`、`runtimeDiagnostics`、主动消息 `randomizedSchedule / lastSent / ambientPresence` 拆到 `persona_runtime_states`。
  - 业务层仍可以传入带 `personaRuntime` 的对象，数据库层负责剥离运行态。
- 旧数据迁移边界已覆盖：
  - root `runtimeLifeState`
  - root `runtimeDiagnostics`
  - root `proactiveMessages` 中的 runtime 字段
  - `profileSections.runtime` 中的 legacy runtime 字段
  - canonical `personaRuntime`

### 导出与删除覆盖

修改位置：

- [server/db.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/db.ts>)
- [server/data-export.test.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/data-export.test.ts>)
- [MIRRAI_PLAN2_PHASE_9_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PLAN2_PHASE_9_AUDIT.md>)

变更：

- `USER_DATA_EXPORT_SECTIONS` 增加 `personaRuntimeStates`。
- `buildUserDataExportPayload` 返回 `personaRuntimeStates` 数组。
- `exportUserData` 查询并导出当前用户的 runtime rows。
- `USER_ACCOUNT_DELETE_SECTIONS` 增加 `personaRuntimeStates`。
- `deleteUserAccount` 删除该用户所有 runtime rows。
- `deletePersona` 删除指定 `(personaId, userId)` 的 runtime row。

## 验证命令与结果

同步盘源码目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/sync-local-worktree.ps1
```

结果：同步到 [F:/Code/Mirrai](<F:/Code/Mirrai>) 成功。

本机运行目录执行：

```powershell
corepack pnpm run check
```

结果：`tsc --noEmit` 通过。

本机运行目录执行：

```powershell
corepack pnpm exec vitest run server/_core/persona-runtime.test.ts server/data-export.test.ts
```

结果：通过，`2 passed / 10 tests passed`。

本机运行目录执行：

```powershell
corepack pnpm exec vitest run server/_core/persona-runtime.test.ts server/data-export.test.ts server/_core/life-schedule.test.ts server/social/persona-text-runtime-platform.test.ts server/social/persona-media-runtime-platform.test.ts server/wechat/proactive-runtime-generation.test.ts
```

结果：通过，`6 passed / 30 tests passed`。

## 阶段 2 验收项

- [x] LLM usage 已有数据库持久化与进程内 fallback。
- [x] `persona_runtime_states` 独立表和迁移已创建。
- [x] persona 读取路径会合并 runtime row，业务层继续看到兼容 `personaRuntime`。
- [x] persona 更新路径会拆出临时运行态，稳定画像不继续被 runtime 字段污染。
- [x] legacy runtime 字段第一次保存时可被抽取到 runtime row。
- [x] 用户导出包含 `personaRuntimeStates`。
- [x] 删除账户和删除 persona 会清理 runtime rows。
- [x] runtime extraction / merge 和数据导出 section 有单元测试覆盖。

## 当前缺口

- 正式 Neon / 远程 PostgreSQL 仍需要按部署流程执行 `drizzle/0008_persona_runtime_states.sql`；本轮只在代码、迁移文件和本机测试层验证。
- `persona_runtime_states` 当前只保存最新 runtime snapshot，不是逐轮历史事件表；如后续需要回放每轮 planner 决策，应另建诊断事件表或日志聚合。
- `profileSections` 仍保留在 `personas.personaData` JSON 内，是否数据库化属于后续 Plan 候选方向，不属于本阶段。

## 阶段 2 当前结论

阶段 2 已完成运行态持久化收口：LLM usage 保持已有落库能力，persona runtime 已从稳定画像 JSON 中拆到独立 `persona_runtime_states` 表；读取路径保持业务兼容，写入路径自动拆分，导出和删除策略已覆盖新增表。后续应继续推进阶段 8，让设置页和诊断体验把 runtime 表、数据安全和省额度状态解释得更清楚。
