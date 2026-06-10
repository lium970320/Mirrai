# Mirrai Plan2 阶段 8 设置页与诊断体验整理记录

记录时间：2026-06-08  
对应计划：[MIRRAI_WORK_PLAN_2.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_WORK_PLAN_2.md>)

## 阶段目标

阶段 8 的目标是让设置页和诊断面板不仅能展示运行事实，也能把问题边界、数据边界和下一步动作说清楚。本轮聚焦 Plan2 阶段 2 / 9 完成后的可见性：运行态已经独立表化，导出 / 删除已经覆盖新增私密数据，正式库需要执行的迁移也应能在运维诊断中看到。

## 本轮完成内容

### 运维诊断增加持久化与数据安全摘要

修改位置：

- [server/social/output-diagnostics.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/output-diagnostics.ts>)
- [server/social/output-diagnostics.test.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/output-diagnostics.test.ts>)
- [client/src/pages/Settings.tsx](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/client/src/pages/Settings.tsx>)

变更：

- `system.operationsDiagnostics` 新增 `persistence` 区块：
  - `runtimeStorage.personaRuntime = "persona_runtime_states"`
  - `runtimeStorage.llmUsage = "llm_usage_records"`
  - Plan2 持久化表清单
  - 用户 JSON 导出 section 清单
  - 删除账户 / 删除 persona 覆盖 section 清单
  - 必跑迁移清单，包含 `0008_persona_runtime_states.sql`
  - 本机同步脚本和本机运行产物清理脚本
- 设置页“运维诊断”新增“持久化与数据安全”卡片：
  - 显示角色运行态表、LLM usage 表、本机清理脚本、同步脚本和正式迁移。
  - 显示导出覆盖与删除覆盖。
  - 显示 runtime 表化、导出排除项和正式迁移注意事项。
- 单元测试确认 diagnostics 不泄露 `apiKey`、`accessToken`、`webhookSecret`、`password` 等字段，并包含 `personaRuntimeStates` 和 `0008_persona_runtime_states.sql`。

### 数据管理页对齐 runtime 表化

修改位置：

- [server/db.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/db.ts>)
- [client/src/pages/Settings.tsx](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/client/src/pages/Settings.tsx>)

变更：

- `getAccountStats` 新增 `totalRuntimeStates`，统计当前用户 `persona_runtime_states` 行数。
- 数据管理页“存储概览”新增“运行态”计数。
- 数据导出文案明确包含“角色运行态”。
- 删除账户文案明确数据库记录覆盖分身、角色运行态、对话、记忆、资料库、Roleplay、平台绑定和 LLM 用量记录。

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
corepack pnpm exec vitest run server/social/output-diagnostics.test.ts server/data-export.test.ts server/_core/persona-runtime.test.ts
```

结果：通过，`3 passed / 17 tests passed`。

接口 smoke：

- 本机服务：[http://127.0.0.1:3000](http://127.0.0.1:3000)
- 通过 `/api/auth/register` 创建临时用户 `codex_phase8_smoke_*`。
- 调用 `/api/trpc/system.operationsDiagnostics` 并验证：
  - `persistence.runtimeStorage.personaRuntime === "persona_runtime_states"`
  - `persistence.exportSections` 包含 `personaRuntimeStates`
  - `persistence.deleteSections` 包含 `personaRuntimeStates`
  - `persistence.requiredMigrations` 包含 `0008_persona_runtime_states.sql`
- 调用 `/api/trpc/user.getAccountStats` 并验证：
  - `totalRuntimeStates` 为 number
- 临时用户已通过 `deleteUserAccount` 清理。

## 当前缺口

- 这次只补“持久化与数据安全”说明；平台错误行动建议和新增枚举中文化仍需继续按实际新增状态滚动补。

## 补充视觉复验

2026-06-09 已补设置页视觉复验：

- 使用本机 Chrome headless 访问 [http://localhost:3000/settings](http://localhost:3000/settings)，创建临时账号 `codex_smoke_*`，打开“运维诊断”页签。
- 桌面 `1280 x 720`：可见运维诊断和 LLM 路由区域；页面级 `documentElement.scrollWidth === clientWidth`，`body.scrollWidth === clientWidth`。
- 移动 `390 x 844`：可见运维诊断和 LLM 路由区域；页面级无横向溢出。
- 进一步滚动到 Phase 3 新增的“上下文上限 / 记忆召回上限 / 资料库召回上限 / 上限说明”区域，桌面和移动均可见且无页面级横向溢出。
- 临时账号已通过 `user.deleteAccount` 清理。
- 截图保存在本机运行数据目录：
  - [settings-llm-limits-detail-desktop-1280x720.png](<F:/.mirrai-local/Mirrai/screenshots/settings-llm-limits-detail-desktop-1280x720.png>)
  - [settings-llm-limits-detail-mobile-390x844.png](<F:/.mirrai-local/Mirrai/screenshots/settings-llm-limits-detail-mobile-390x844.png>)

## 阶段 8 当前结论

阶段 8 完成本轮设置页 / 运维诊断 polish：用户现在能在设置页看到 Plan2 新增持久化表、导出覆盖、删除覆盖、本机清理脚本和正式迁移清单；数据管理页也能看到 runtime 状态计数并明确导出 / 删除边界。桌面和移动视觉复验已补齐，后续只需按新增平台状态继续滚动补中文化和行动建议。
