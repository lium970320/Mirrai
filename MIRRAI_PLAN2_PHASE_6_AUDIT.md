# Mirrai Plan2 阶段 6 长期记忆治理与资料库产品化记录

记录时间：2026-06-08  
对应计划：[MIRRAI_WORK_PLAN_2.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_WORK_PLAN_2.md>)

## 阶段目标

阶段 6 的目标是把长期记忆和原著资料库从“后端能召回”推进到“用户能看见、能校正、能解释、能治理”。本阶段先完成两个最小闭环：让聊天页记忆抽屉具备治理能力，并让原著资料库具备只读概览与检索预览能力。

## 已有基线盘点

后端已经具备较完整的第一版基础：

- `memories` 表已支持 `source`、`memoryType`、`importance`、`confidence`、`keywords`、`emotion`、`lastAccessedAt`、`evidenceMessageIds`、`status`。
- `memory-recall` 只召回 `active` 记忆，会按关键词、类型、重要度和可信度排序。
- `memory-governance` 支持跳过重复记忆、把旧冲突记忆标记为 `contradicted`、把已解决 open loop 归档。
- `source-recall` 已支持原著问题触发、连续追问、纠错句二次检索和证据不足回退。
- `source-grounding` 已支持低温证据复核，避免用人物长背景或上一轮错误补编原著细节。

## 本轮完成内容

### 记忆列表用户隔离

修改位置：

- [server/db.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/db.ts>)
- [server/routers.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/routers.ts>)

变更：

- `getMemoriesByPersonaId` 从只按 `personaId` 查询，改为同时按 `personaId` 和 `userId` 查询。
- `memory.list` 调用时传入 `ctx.user.id`。

原因：长期记忆是私密数据，即使上层已校验 persona 所属用户，底层查询也应保留用户边界。

### 聊天页记忆治理抽屉

修改位置：

- [client/src/pages/Chat.tsx](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/client/src/pages/Chat.tsx>)

新增能力：

- 状态筛选：全部、有效、归档、标错。
- 类型筛选：用户事实、关系事件、承诺、偏好、情绪节点、冲突、未完成话题、人物背景、原著资料、每日总结。
- 来源筛选：手动、聊天、每日整理、资料、导入、系统。
- 标题、描述、关键词搜索。
- 展示状态、类型、来源、重要度、可信度、情绪和关键词。
- 新增记忆时可设置类型、来源、重要度、可信度、关键词和情绪。
- 编辑已有记忆的完整治理字段。
- 快速归档、标错、恢复和删除。
- 标错时将状态改为 `contradicted`，并把可信度降到 1。
- 展示证据消息 ID，方便后续追溯来源。

### 资料库只读产品化抽屉

修改位置：

- [server/db.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/db.ts>)
- [server/routers.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/routers.ts>)
- [client/src/pages/Chat.tsx](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/client/src/pages/Chat.tsx>)

新增能力：

- 新增 `sourceLibrary.overview` 只读接口，按 `personaId + userId` 返回资料库概览。
- 展示 source 数、chunk 数、章节数和 token 估算。
- 展示已导入 source 列表、source 类型、原文件名、章节列表和每章 chunk 数。
- 汇总展示资料库关键词，关键词可一键带入检索预览。
- 支持在资料库抽屉里发起检索预览，显示命中 source、章节、score、原文片段和真实命中词。
- 邻近补充片段会标记为“关联片段”，不再把种子片段命中词误显示成该片段自身命中词。
- 检索无命中时显示“证据不足”回退提示，提醒角色应承认记不准，不应继续补编。
- 资料库重新导入和删除先保留为只读说明，不在本阶段加入写操作，避免绕过阶段 9 的导出/删除/备份策略。

## 验证命令与结果

同步盘源码目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/sync-local-worktree.ps1
```

结果：同步到 [F:/Code/Mirrai](<F:/Code/Mirrai>) 成功。

本机运行目录执行：

```powershell
corepack pnpm exec vitest run server/social/memory-card.test.ts server/social/memory-consolidation.test.ts server/social/memory-governance.test.ts server/social/memory-recall.test.ts server/social/source-recall.test.ts server/social/source-grounding.test.ts
```

结果：通过，`6 passed / 19 tests passed`。

本机运行目录执行：

```powershell
corepack pnpm run check
```

结果：`tsc --noEmit` 通过。

本机运行目录执行：

```powershell
corepack pnpm exec vitest run server/llm/usage.test.ts server/llm/economy.test.ts server/social/persona-text-runtime-platform.test.ts server/qq/message-handler.test.ts server/social/output-diagnostics.test.ts
```

结果：通过，`5 passed / 30 tests passed`。

本机运行目录再次执行：

```powershell
corepack pnpm run check
corepack pnpm exec vitest run server/social/source-recall.test.ts server/social/source-grounding.test.ts
corepack pnpm exec vitest run server/social/memory-card.test.ts server/social/memory-consolidation.test.ts server/social/memory-governance.test.ts server/social/memory-recall.test.ts
```

结果：通过；`tsc --noEmit` 通过，source recall / grounding `2 passed / 9 tests passed`，memory focused `4 passed / 10 tests passed`。

浏览器 smoke：

- 使用本机服务 [http://localhost:3000](http://localhost:3000) 和临时 smoke 用户验证 `/chat/:id`。
- 桌面 `1280 x 720`：
  - 聊天页：无页面级横向溢出。
  - 记忆抽屉：展示筛选、编辑、归档、标错、删除；标错后状态变为 `contradicted`，可信度降到 1；恢复可见。
  - 资料库抽屉：展示 source / chunk / 章节 / token / 关键词；检索“老鹰峡”显示命中词和关联片段；检索不存在词显示证据不足提示；无页面级横向溢出。
- 移动 `390 x 844`：
  - 聊天页：无页面级横向溢出。
  - 记忆抽屉：无页面级横向溢出。
  - 资料库抽屉：无页面级横向溢出。
- 临时 `codex_smoke_*` 用户、角色、记忆和资料库测试数据已通过 `deleteUserAccount` 清理。

## 当前缺口

- `memory.autoExtract` 当前直接写入提取结果，没有先进入人工确认队列；后续可以改成先展示候选卡片，由用户确认后保存。
- 资料库“本轮聊天实际用了哪些证据”仍主要在诊断链路和 source recall 内部上下文中体现，聊天消息旁还没有独立的用户可见证据记录。
- 资料库重新导入 / 删除入口尚未接入；本阶段有意只做只读说明，写操作应与阶段 9 的导出、删除和备份策略一起收口。
- 删除 / 导出策略尚未在阶段 6 完整覆盖，后续会在阶段 9 做系统收口。

## 阶段 6 当前结论

阶段 6 的核心最小交付已完成：用户现在可以在聊天页直接治理长期记忆，也能在资料库抽屉里看到已导入来源、章节统计、关键词、检索命中片段和证据不足回退提示。桌面和移动浏览器 smoke 已通过。剩余的自动记忆确认队列、资料库写操作和导出/删除策略转入后续阶段继续收口。
