# Mirrai Plan2 阶段 1 发布候选基线与回归矩阵记录

记录时间：2026-06-08  
对应计划：[MIRRAI_WORK_PLAN_2.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_WORK_PLAN_2.md>)  
回归清单：[docs/release-candidate-checklist.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/docs/release-candidate-checklist.md>)

## 阶段目标

阶段 1 的目标是建立一个日常开发前后都能快速执行的发布候选基线：同步盘源码只负责保存源码，本机运行目录负责安装依赖、执行类型检查、运行 focused tests 和后续浏览器 / QQ 验证。

## 本轮完成内容

- 已创建发布候选回归清单，覆盖同步盘卫生、本机同步、类型检查、迁移检查、核心 focused tests、UI smoke、QQ / OneBot 手动验证和临时数据清理。
- 已从同步盘源码目录同步到本机运行目录 [Mirrai](<F:/Code/Mirrai>)。
- 已执行 Plan2 Stage 1 最小回归矩阵。
- 已修复 QQ handler 测试中的异步 batch 等待问题，避免 `enqueueWechatTextMessage` 的 `onBatch` promise 在测试用例之间串扰。
- 已重新执行 QQ 单文件测试、最小回归矩阵和 TypeScript 类型检查。

## 发现的问题与修复

### QQ message-handler 测试异步串扰

最小回归矩阵第一次执行时，`server/qq/message-handler.test.ts` 出现跨用例串扰：

- 私聊文本用例期望发送 `"我在。"`，但断言时还没有发送。
- 后续语音用例期望没有文字发送，却观察到上一条 `"我在。"` 延迟到达。

原因是测试 mock 中的 `enqueueWechatTextMessage` 触发了异步 `options.onBatch(...)`，但没有把 promise 暴露给测试等待；原来的 `waitForQueuedReply()` 只 `setTimeout(10)`，在并发 vitest 文件运行时不稳定。

修复位置：

- [server/qq/message-handler.test.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/qq/message-handler.test.ts>)

修复方式：

- 在 hoisted mock 中维护 `pendingBatches`。
- `enqueueWechatTextMessage` 把 `Promise.resolve(options.onBatch(...))` 记录到 `pendingBatches`。
- `waitForQueuedReply()` 使用 `Promise.allSettled` 等待并清空当前 pending batch。
- `beforeEach` 清空 pending batch，`afterEach` 也等待剩余 batch，防止异步回复落到下一条用例。

## 本轮验证命令与结果

同步盘源码目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/sync-local-worktree.ps1
```

结果：同步到 [F:/Code/Mirrai](<F:/Code/Mirrai>) 成功。`robocopy` 报告本机运行目录存在 `.playwright-cli` 临时验证文件，这属于本机运行产物，不来自同步盘源码。

本机运行目录执行：

```powershell
corepack pnpm exec vitest run server/qq/message-handler.test.ts
```

结果：通过，`1 passed / 16 tests passed`。

本机运行目录执行：

```powershell
corepack pnpm exec vitest run server/llm/usage.test.ts server/llm/economy.test.ts server/social/persona-text-runtime-platform.test.ts server/qq/message-handler.test.ts server/social/output-diagnostics.test.ts
```

结果：通过，`5 passed / 29 tests passed`。

本机运行目录执行：

```powershell
corepack pnpm run check
```

结果：`tsc --noEmit` 通过。

## 阶段 1 验收项

- [x] 发布候选回归清单已创建。
- [x] 最小 focused regression matrix 已实际运行。
- [x] QQ 私聊文本、语音降级、语音输出、图片 fallback、表情包 fallback 的 mock 事件测试通过。
- [x] LLM usage、economy policy、shared runtime platform、output diagnostics 的最小组合测试通过。
- [x] TypeScript 类型检查通过。
- [x] 已记录测试不稳定点和修复方式。

## 尚未完成或需后续阶段承接

- 真实 QQ / NapCat / OneBot 在线端到端验证尚未执行，应进入 Plan2 阶段 5。
- 完整 focused test 清单尚未一次性全部执行；当前阶段只建立了最小基线。
- UI smoke test 需要在后续涉及设置页、诊断页或 Roleplay UI 时重新执行桌面和移动视口验证。
- 本机运行目录的 `.playwright-cli` 临时验证文件应在需要清理本机运行产物时删除，不应同步回源码目录。

## 阶段 1 结论

Plan2 阶段 1 已完成最小发布候选基线：核心 focused regression matrix 和类型检查均通过，且已把 QQ handler 异步测试串扰修复为可等待的 promise 模型。下一步应优先推进阶段 5 的真实 QQ / NapCat 端到端验证文档与预检流程；如果真实 QQ 环境暂不可用，也应先把可复现步骤、配置检查和日志定位收束成文档。
