# Mirrai Plan2 阶段 4 社交适配层与迁移确认记录

记录时间：2026-06-09  
对应计划：[MIRRAI_WORK_PLAN_2.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_WORK_PLAN_2.md>)

## 阶段目标

阶段 4 的主目标是让 Web / QQ / WeChat 继续作为同一套 shared social runtime 的适配入口，并补齐真实数据库迁移执行确认。Plan1 已完成 runtime contract 基线；本轮聚焦“迁移是否真的可验证”，避免发布候选只靠文档提醒。

## 本轮完成内容

### Plan2 数据库 schema 只读检查

修改位置：

- [scripts/check-db-migrations.mjs](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/scripts/check-db-migrations.mjs>)
- [package.json](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/package.json>)
- [docs/release-candidate-checklist.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/docs/release-candidate-checklist.md>)

变更：

- 新增 `corepack pnpm run db:check`。
- 只读检查当前在线 `DATABASE_URL` 是否具备 Plan2 关键 schema：
  - Roleplay 三张表和索引。
  - `memories` 结构化记忆字段和索引。
  - `channel` enum 中的 `qq`。
  - `llm_usage_records` 表、归属字段和索引。
  - `persona_runtime_states` 表、字段和索引。
- 输出不包含数据库用户名、密码或完整连接串。
- 数据库未在线时给出明确提示：该检查不执行迁移；先确认 `DATABASE_URL` 指向目标库并启动数据库。

### 本机嵌入式 PostgreSQL 检查路径

修改位置：

- [scripts/local-db.mjs](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/scripts/local-db.mjs>)
- [package.json](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/package.json>)
- [docs/release-candidate-checklist.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/docs/release-candidate-checklist.md>)

变更：

- 新增 `corepack pnpm run db:local:check`。
  - 临时启动 `F:/.mirrai-local/Mirrai` 下的嵌入式 PostgreSQL。
  - 执行同一套只读 Plan2 schema 检查。
  - 检查后关闭本机 PostgreSQL。
- 改进 `db:local:prepare`：
  - 旧逻辑只要发现 `users / personas / messages / memories` 核心表存在就跳过迁移。
  - 新逻辑会继续执行 Plan2 schema check。
  - 如果旧本机库缺 Plan2 项，会按顺序执行已提交的幂等迁移片段 `0003` 到 `0008`，而不是临时生成全量迁移。
  - 本轮实际修复了旧本机库缺失的 `channel.qq` enum 值。

## 验证命令与结果

同步盘源码目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/sync-local-worktree.ps1
```

结果：同步到 [F:/Code/Mirrai](<F:/Code/Mirrai>) 成功。

本机运行目录执行：

```powershell
corepack pnpm run db:local:prepare
```

结果：

- 启动本机 PostgreSQL `127.0.0.1:5434`。
- 首次检查发现旧本机库缺 `channel.qq`。
- 自动执行 `0003_roleplay_channels.sql` 到 `0008_persona_runtime_states.sql` 的兼容迁移片段。
- 复查通过：`ok: true`，`missingCount: 0`。
- 关闭本机 PostgreSQL。

本机运行目录执行：

```powershell
corepack pnpm run db:local:check
```

结果：通过。

```text
Mirrai Plan2 database schema check
Status: OK (0 missing)
tables: 5 ok, 0 missing
columns: 19 ok, 0 missing
indexes: 15 ok, 0 missing
enumValues: 1 ok, 0 missing
```

本机运行目录执行：

```powershell
corepack pnpm run db:check
```

结果：当前 `.env` 指向 `127.0.0.1:5434`，而 `db:local:check` 结束后会关闭嵌入式 PostgreSQL，因此 `db:check` 按预期提示 `connect ECONNREFUSED 127.0.0.1:5434`，并说明它是只读在线库检查，不会启动数据库或执行迁移。

本机运行目录执行：

```powershell
corepack pnpm run check
corepack pnpm exec vitest run server/social/output-diagnostics.test.ts server/data-export.test.ts server/_core/persona-runtime.test.ts
```

结果：

- `tsc --noEmit` 通过。
- focused tests 通过，`3 passed / 17 tests passed`。

## 阶段 4 验收项

- [x] Web / QQ / WeChat shared runtime contract 已由 Plan1 阶段 4 完成并保留。
- [x] 发布候选清单有明确 DB schema 检查命令。
- [x] 当前在线库检查和本机嵌入式库检查分开，避免混淆 `DATABASE_URL`。
- [x] 本机旧库如果只缺 Plan2 兼容迁移，会自动执行已提交迁移片段并复查。
- [x] 本机库检查已获得 `Status: OK (0 missing)` 证据。

## 当前缺口

- Neon / 远程 PostgreSQL 的 `db:check` 仍需要在 `DATABASE_URL` 指向目标远程库且网络可达时执行；本轮没有对远程库做实际迁移或检查。
- 真实 QQ / NapCat 在线端到端验证仍属于阶段 5，需要 OneBot 在线和测试联系人私聊输入。

## 阶段 4 当前结论

阶段 4 的迁移执行确认工具已完成：本机库可通过 `db:local:prepare` 自动补齐 Plan2 兼容迁移，并通过 `db:local:check` 得到只读 schema OK 证据；远程 / Neon 库的检查路径也已明确为 `db:check`。后续应继续等待阶段 5 的真实 QQ 在线条件，或推进阶段 3 成本控制剩余增强。
